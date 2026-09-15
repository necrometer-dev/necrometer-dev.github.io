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

  // Resolve to the right endpoint. With no token, /users/{n}/repos is
  // public-only and works for both users and orgs. With a token we
  // disambiguate so private repos on the token's own account show up.
  async function resolveEndpoint(name, headers) {
    try {
      const org = await fetch(API + '/orgs/' + enc(name), { headers });
      if (org.ok) {
        const j = await org.json();
        if (j.type === 'Organization')
          return API + '/orgs/' + enc(name) + '/repos?type=all';
      }
      const me = await fetch(API + '/user', { headers });
      if (me.ok) {
        const m = await me.json();
        if (m.login && m.login.toLowerCase() === name.toLowerCase())
          return API + '/user/repos?visibility=all&affiliation=owner';
      }
    } catch (_) { /* fall through */ }
    return API + '/users/' + enc(name) + '/repos';
  }

  // Fetch up to 1000 repos across 10 pages of 100.
  async function fetchRepos(name, onPage, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const base = token ? await resolveEndpoint(name, headers) : API + '/users/' + enc(name) + '/repos';
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
    const first = await get(1);
    if (first.length < 100) return first;
    const out = first.slice();
    for (const batch of [[2, 3, 4], [5, 6, 7, 8, 9, 10]]) {
      const pages = await Promise.all(batch.map(get));
      for (const rows of pages) out.push(...rows);
      if (pages.some((r) => r.length < 100)) break;
    }
    return out;
  }

  return { fetchRepos, NotFound, Upstream };
});

// ---------- node CLI ----------
// node necrometer.js <user-or-org>  (requires ./pkg/necrometer.js)
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const { fetchRepos } = module.exports;
  const name = process.argv[2];
  if (!name) {
    console.error('usage: node necrometer.js <user-or-org>');
    process.exit(2);
  }
  (async () => {
    const token = process.env.NECRO_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const wasm = require('./pkg/necrometer.js');
    const fs = require('fs');
    const wasmBytes = fs.readFileSync('./pkg/necrometer_bg.wasm');
    if (typeof wasm.initSync === 'function') wasm.initSync({ module: wasmBytes });
    else await wasm.default(wasmBytes);
    const repos = await fetchRepos(name, null, token);
    const reading = wasm.analyze_repos(name, JSON.stringify(repos));
    const svg = wasm.render_card(reading);
    process.stdout.write(svg);
  })().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
