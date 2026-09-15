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

  // Detect whether `name` is a user or an org. Hits `/users/{n}` and
  // `/orgs/{n}` in parallel; the org response wins if 200. If both
  // 404, throw NotFound.
  async function detectKind(name, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const [u, o] = await Promise.all([
      fetch(API + '/users/' + enc(name), { headers }).then(r => r.status),
      fetch(API + '/orgs/' + enc(name), { headers }).then(r => r.status),
    ]);
    if (o === 200) return 'org';
    if (u === 200) return 'user';
    throw new NotFound('no such user or org: ' + name);
  }

  // Resolve the right repos endpoint.
  //   - anonymous: orgs → /orgs/{n}/repos, users → /users/{n}/repos
  //   - with token: orgs → /orgs/{n}/repos?type=all (so private repos the
  //     token can see show up); user → /users/{n}/repos
  function repoEndpoint(name, kind, token) {
    if (kind === 'org')
      return API + '/orgs/' + enc(name) + (token ? '/repos?type=all' : '/repos');
    return API + '/users/' + enc(name) + '/repos';
  }

  // Fetch up to MAX_PAGES × 100 = 3000 repos. Returns the projected
  // 7-tuples (not the raw objects) so the caller hands ~1/30th the
  // bytes to wasm.
  async function fetchRepos(name, kind, onPage, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const base = repoEndpoint(name, kind, token);
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
    if (first.length < 100) return { kind, repos: out };

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
    return { kind, repos: out };
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
    const kind = await detectKind(name, token);
    const wasm = require('./pkg/seance.js');
    const fs = require('fs');
    const wasmBytes = fs.readFileSync('./pkg/seance_bg.wasm');
    if (typeof wasm.initSync === 'function') wasm.initSync({ module: wasmBytes });
    else await wasm.default(wasmBytes);
    const { repos } = await fetchRepos(name, kind, null, token);
    const reading = wasm.analyze_repos(name, kind, JSON.stringify(repos));
    const svg = wasm.render_card(reading);
    process.stdout.write(svg);
  })().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
