/* necrometer.js — thin shim. The Rust core (compiled to wasm) does
 * all analysis and rendering; this file only:
 *   1. fetches a user's (or org's) public repos from api.github.com,
 *   2. hands them to the wasm `analyze_repos`, and
 *   3. hands the resulting reading to `render_card`.
 *
 * Anonymous GitHub is 60 req/hr. Google is ~30 pages by itself.
 * We peek /rate_limit (doesn't count), refuse if we can't finish,
 * and page in batches no larger than remaining.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Necrometer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.github.com';
  const MAX_PAGES = 30;

  class NotFound extends Error {}
  class Upstream extends Error {}

  const enc = encodeURIComponent;

  const KEEP_REPO = (r) => ({
    name: r.name,
    pushed_at: r.pushed_at || null,
    created_at: r.created_at || null,
    archived: r.archived === true,
    fork: r.fork === true,
    stargazers_count: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    html_url: r.html_url || '',
  });

  function kindFromUserPayload(j) {
    return j && j.type === 'Organization' ? 'org' : 'user';
  }

  function pagesNeeded(publicRepos) {
    const n = Number(publicRepos) || 0;
    if (n <= 0) return 1;
    return Math.min(MAX_PAGES, Math.ceil(n / 100));
  }

  function waitMinutes(resetUnix) {
    const reset = Number(resetUnix);
    if (!reset) return null;
    const ms = reset * 1000 - Date.now();
    if (ms <= 0 || ms > 3600e3) return null;
    return Math.max(1, Math.ceil(ms / 60000));
  }

  function limitMessage(resetUnix) {
    const m = waitMinutes(resetUnix);
    return m ? 'GitHub rate limit — try again in ' + m + 'm' : 'GitHub rate limit hit';
  }

  function quotaMessage(name, publicRepos, remaining, resetUnix) {
    const pages = pagesNeeded(publicRepos);
    const m = waitMinutes(resetUnix);
    const wait = m ? ' (resets in ' + m + 'm)' : '';
    return name + ' has ~' + publicRepos + ' public repos (~' + pages +
      ' GitHub API calls). Anonymous quota has ' + remaining + ' left this hour' +
      wait + '. Paste a token (public repo read, 5000/hr) or try a smaller subject.';
  }

  function cannotAfford(remaining, pages) {
    if (remaining == null || remaining < 0) return false;
    return remaining < pages + 1;
  }

  function throwIfLimited(resp) {
    if (resp.status !== 403 && resp.status !== 429) return;
    throw new Upstream(limitMessage(resp.headers.get('x-ratelimit-reset')));
  }

  function remainingOf(resp) {
    const v = resp.headers.get('x-ratelimit-remaining');
    return v == null ? null : Number(v);
  }

  async function peekQuota(token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      const r = await fetch(API + '/rate_limit', { headers });
      if (!r.ok) return { remaining: null, reset: null };
      const j = await r.json();
      const core = (j.resources && j.resources.core) || {};
      return {
        remaining: typeof core.remaining === 'number' ? core.remaining : null,
        reset: core.reset || null,
      };
    } catch (_) {
      return { remaining: null, reset: null };
    }
  }

  async function detectKind(name, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    const user = API + '/users/' + enc(name);
    const r1 = await fetch(user, { headers });
    throwIfLimited(r1);
    if (r1.status === 200) {
      const j = await r1.json();
      const kind = kindFromUserPayload(j);
      const endpoint = kind === 'org'
        ? API + '/orgs/' + enc(name) + (token ? '/repos?type=all' : '/repos')
        : API + '/users/' + enc(name) + '/repos';
      return { kind, endpoint, publicRepos: j.public_repos || 0, remaining: remainingOf(r1) };
    }
    if (r1.status !== 404 && r1.status !== 422) {
      throw new Upstream('GitHub: HTTP ' + r1.status);
    }

    const orgRepos = API + '/orgs/' + enc(name) +
      (token ? '/repos?type=all' : '/repos');
    const r2 = await fetch(orgRepos + (orgRepos.includes('?') ? '&' : '?') + 'per_page=1', { headers });
    throwIfLimited(r2);
    if (r2.status === 200) return { kind: 'org', endpoint: orgRepos, publicRepos: 0, remaining: remainingOf(r2) };
    if (r2.status === 404) throw new NotFound('no such user or org: ' + name);
    throw new Upstream('GitHub: HTTP ' + r2.status);
  }

  async function fetchRepos(name, resolved, onPage, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const { kind, endpoint, publicRepos } = resolved;
    const sep = endpoint.includes('?') ? '&' : '?';

    let remaining = resolved.remaining;
    if (remaining == null) {
      const q = await peekQuota(token);
      remaining = q.remaining;
    }
    const pages = pagesNeeded(publicRepos);
    if (!token && cannotAfford(remaining, pages) && publicRepos > 100) {
      const q = await peekQuota(token);
      throw new Upstream(quotaMessage(name, publicRepos, q.remaining != null ? q.remaining : remaining, q.reset));
    }

    async function get(page) {
      const resp = await fetch(endpoint + sep + 'per_page=100&page=' + page, { headers });
      if (resp.status === 404) throw new NotFound('no such user or org: ' + name);
      throwIfLimited(resp);
      if (!resp.ok) throw new Upstream('GitHub: HTTP ' + resp.status);
      remaining = remainingOf(resp);
      const rows = await resp.json();
      if (onPage) onPage(rows.length, remaining);
      return rows;
    }

    const first = await get(1);
    const out = [];
    for (const r of first) out.push(KEEP_REPO(r));
    if (first.length < 100) return { kind, endpoint, repos: out };

    // Parallel burns the 60/hr cap in bursts. Batch size follows remaining.
    for (let i = 2; i <= MAX_PAGES; ) {
      const left = remaining == null ? 4 : Math.max(1, Math.min(4, remaining - 1));
      const idxs = [];
      for (let k = 0; k < left && i + k <= MAX_PAGES; k++) idxs.push(i + k);
      const batch = await Promise.all(idxs.map(get));
      let short = false;
      for (const rows of batch) {
        for (const r of rows) out.push(KEEP_REPO(r));
        if (rows.length < 100) short = true;
      }
      if (short) break;
      i += idxs.length;
    }
    return { kind, endpoint, repos: out };
  }

  return {
    fetchRepos, detectKind, kindFromUserPayload, KEEP_REPO,
    pagesNeeded, cannotAfford, quotaMessage, limitMessage, peekQuota,
    NotFound, Upstream,
  };
});
