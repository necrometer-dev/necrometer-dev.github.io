/* necrometer.js — thin shim. The Rust core (compiled to wasm) does
 * all analysis and rendering; this file only:
 *   1. fetches a user's (or org's) public repos from api.github.com,
 *   2. hands them to the wasm `analyze_repos`, and
 *   3. hands the resulting reading to `render_card`.
 *
 * Both the browser (window.Necrometer) and node CLI use the same API.
 * No framework, no build step. CSP-safe (no eval, no inline scripts).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Necrometer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.github.com';

  class NotFound extends Error {}
  class Upstream extends Error {}

  const enc = encodeURIComponent;

  // GitHub returns a fat object per repo (~5KB including topics,
  // permissions, license, default_branch, watchers…). We only need 7
  // fields. Projecting them in JS keeps the wasm-boundary JSON tiny,
  // which matters for big orgs (Google has 2,900 repos → ~15MB raw).
  // Shape stays an object (not a tuple) so the Rust parser in wasm
  // doesn't need to change.
  const KEEP_REPO = (r) => ({
    name: r.name,
    pushed_at: r.pushed_at || null,
    created_at: r.created_at || null,
    archived: r.archived === true,
    fork: r.fork === true,
    stargazers_count: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    html_url: r.html_url || '',
  });

  // Resolve kind (user vs org) for `name`. To save rate-limit budget
  // (anonymous visitors share a 60/hr quota) we make at most one
  // discovery call in the common case: try `/users/{n}/repos` first,
  // since GitHub routes both users and orgs through it. Only when
  // that 404s do we fall back to `/orgs/{n}/repos`. We also surface
  // 403/429 from the discovery call as `Upstream` so the UI shows
  // the real reason ("rate limited") instead of "no such user".
  async function detectKind(name, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const userRepos = API + '/users/' + enc(name) + '/repos';

    const probe = async (url) => {
      const r = await fetch(url + '?per_page=1', { headers });
      if (r.status === 403 || r.status === 429) {
        const reset = r.headers.get('x-ratelimit-reset');
        const wait = reset ? Math.max(0, reset * 1000 - Date.now()) : null;
        throw new Upstream(wait && wait < 3600e3
          ? 'GitHub rate limit — try again in ' + Math.ceil(wait / 60000) + 'm'
          : 'GitHub rate limit hit');
      }
      return r;
    };

    // Most accounts (users and orgs alike) come back through /users.
    // 404 means "definitely not a user" — try /orgs. 422 means "looks
    // like an org, /users rejects you" — also try /orgs. Anything
    // else is real upstream trouble; surface verbatim.
    const r1 = await probe(userRepos);
    if (r1.status === 200) return { kind: 'user', endpoint: userRepos };
    if (r1.status !== 404 && r1.status !== 422) {
      throw new Upstream('GitHub: HTTP ' + r1.status);
    }

    // /users rejected; try /orgs.
    const orgRepos = API + '/orgs/' + enc(name) +
      (token ? '/repos?type=all' : '/repos');
    const r2 = await probe(orgRepos);
    if (r2.status === 200) return { kind: 'org', endpoint: orgRepos };
    if (r2.status === 404) throw new NotFound('no such user or org: ' + name);
    throw new Upstream('GitHub: HTTP ' + r2.status);
  }

  // Fetch repos for a name. `resolved` is the {kind, endpoint} returned
  // by detectKind — endpoint is the URL to page through. In the common
  // case we've already used per_page=1 to confirm it works, so we just
  // continue from there.
  async function fetchRepos(name, resolved, onPage, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const { kind, endpoint } = resolved;
    const base = endpoint;
    const sep = base.includes('?') ? '&' : '?';

    async function get(page) {
      const resp = await fetch(base + sep + 'per_page=100&page=' + page, { headers });
      if (resp.status === 404) throw new NotFound('no such user or org: ' + name);
      if (resp.status === 403 || resp.status === 429) {
        const reset = resp.headers.get('x-ratelimit-reset');
        const wait = reset ? Math.max(0, reset * 1000 - Date.now()) : null;
        throw new Upstream(wait && wait < 3600e3
          ? 'GitHub rate limit — try again in ' + Math.ceil(wait / 60000) + 'm'
          : 'GitHub rate limit hit');
      }
      if (!resp.ok) throw new Upstream('GitHub: HTTP ' + resp.status);
      const rows = await resp.json();
      if (onPage) onPage(rows.length, resp.headers.get('x-ratelimit-remaining'));
      return rows;
    }

    const MAX = 30;            // 30 × 100 = 3000 repos, covers current top orgs
    const first = await get(1);
    const out = [];
    for (const r of first) out.push(KEEP_REPO(r));
    if (first.length < 100) return { kind, endpoint, repos: out };

    // Paged in parallel batches of 4 to stay under the anonymous
    // 60/hr quota while not being unnecessarily slow.
    for (let i = 2; i <= MAX; i += 4) {
      const idxs = [i, i + 1, i + 2, i + 3].filter(p => p <= MAX);
      const pages = await Promise.all(idxs.map(get));
      let short = false;
      for (const rows of pages) {
        for (const r of rows) out.push(KEEP_REPO(r));
        if (rows.length < 100) short = true;
      }
      if (short) break;
    }
    return { kind, endpoint, repos: out };
  }

  return { fetchRepos, detectKind, KEEP_REPO, NotFound, Upstream };
});

// ---------- node CLI ----------
// node necrometer.js <user-or-org>  (requires ./pkg/seance.js)
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const { fetchRepos, detectKind } = module.exports;
  const name = process.argv[2];
  if (!name) {
    console.error('usage: node necrometer.js <user-or-org>');
    process.exit(2);
  }
  (async () => {
    const token = process.env.NECRO_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const resolved = await detectKind(name, token);
    const wasm = require('./pkg/seance.js');
    const fs = require('fs');
    const wasmBytes = fs.readFileSync('./pkg/seance_bg.wasm');
    if (typeof wasm.initSync === 'function') wasm.initSync({ module: wasmBytes });
    else await wasm.default(wasmBytes);
    const { kind, repos } = await fetchRepos(name, resolved, null, token);
    const reading = wasm.analyze_repos(name, kind, JSON.stringify(repos));
    const svg = wasm.render_card(reading);
    process.stdout.write(svg);
  })().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
