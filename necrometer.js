/* necrometer.js — the engine. Isomorphic: browser <script> global AND node CLI.
 * CLI:  node necrometer.js <user-or-org> [out.svg]
 * Browser: window.Necrometer.{fetchRepos,analyze,renderCard}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Necrometer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.github.com';
  const MAX_PAGES = 10;

  // ---------- github ----------

  class NotFound extends Error {}
  class Upstream extends Error {}

  // Works for users AND orgs. /users/{n}/repos is public-only even with a token —
  // so with a token we resolve the right endpoint: /orgs for orgs, /user for
  // the token's own account (sees private repos), /users otherwise.
  async function fetchRepos(name, onPage, token) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const base = token ? await resolveEndpoint(name, headers) : `${API}/users/${enc(name)}/repos`;
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const sep = base.includes('?') ? '&' : '?';
      const resp = await fetch(`${base}${sep}per_page=100&page=${page}`, { headers });
      if (resp.status === 404) throw new NotFound(`no such user or org: ${name}`);
      if (resp.status === 403 || resp.status === 429) {
        const reset = resp.headers.get('x-ratelimit-reset');
        const wait = reset ? Math.max(0, reset * 1000 - Date.now()) : null;
        throw new Upstream(wait && wait < 3600e3
          ? `GitHub rate limit — try again in ${Math.ceil(wait / 60000)}m`
          : 'GitHub rate limit hit');
      }
      if (!resp.ok) throw new Upstream(`GitHub: HTTP ${resp.status}`);
      const rows = await resp.json();
      out.push(...rows);
      if (onPage) onPage(rows.length, resp.headers.get('x-ratelimit-remaining'));
      if (rows.length < 100) break;
    }
    return out;
  }

  const enc = encodeURIComponent;

  async function resolveEndpoint(name, headers) {
    try {
      const org = await fetch(`${API}/orgs/${enc(name)}`, { headers });
      if (org.ok) {
        const j = await org.json();
        if (j.type === 'Organization')
          return `${API}/orgs/${enc(name)}/repos?type=all`;
      }
      const me = await fetch(`${API}/user`, { headers });
      if (me.ok) {
        const m = await me.json();
        if (m.login && m.login.toLowerCase() === name.toLowerCase())
          return `${API}/user/repos?visibility=all&affiliation=owner`;
      }
    } catch (_) { /* fall through to public endpoint */ }
    return `${API}/users/${enc(name)}/repos`;
  }

  // ---------- metrics ----------

  const FATE_LABEL = ['alive', 'cooling', 'cold', 'dead', 'buried'];
  const FATE_WEIGHT = [0, 0.33, 0.66, 1.0, 1.0];
  const F_ALIVE = 0, F_COOLING = 1, F_COLD = 2, F_DEAD = 3, F_BURIED = 4;

  function fateOf(repo, now) {
    if (repo.archived) return F_BURIED;
    const last = repo.pushed_at ? Date.parse(repo.pushed_at) : Date.parse(repo.created_at);
    const d = (now - last) / 86400e3;
    if (d < 30) return F_ALIVE;
    if (d < 180) return F_COOLING;
    if (d < 730) return F_COLD;
    return F_DEAD;
  }

  function titleFor(index, total) {
    if (total === 0) return 'Ghost — nothing to bury';
    if (total < 3) return 'Insufficient Corpses';
    if (index < 15) return 'The Maintainer';
    if (index < 35) return 'Healthy Churn';
    if (index < 60) return 'Serial Starter';
    if (index < 80) return 'Graveyard Keeper';
    return 'Repo Necromancer';
  }

  function flavorFor(index, total) {
    if (total === 0) return 'no repos. no pulse. nothing.';
    if (total < 3) return 'not enough bodies to judge';
    if (index < 15) return 'nothing dies here. suspicious.';
    if (index < 35) return 'a few corpses, like everyone';
    if (index < 60) return 'starts things. finishes? unclear.';
    if (index < 80) return 'more graves than gardens';
    return 'not a profile — a cemetery';
  }

  function analyze(subject, repos) {
    const now = Date.now();
    const owned = repos.filter((r) => !r.fork);
    const total = owned.length;
    const counts = [0, 0, 0, 0, 0];
    const entries = [];
    let weightSum = 0, starsStranded = 0, stillborn = 0, lastPush = 0;

    for (const repo of owned) {
      const fate = fateOf(repo, now);
      counts[fate]++;
      weightSum += FATE_WEIGHT[fate];
      const createdAt = Date.parse(repo.created_at);
      const lastActivity = repo.pushed_at ? Date.parse(repo.pushed_at) : createdAt;
      if (lastActivity > lastPush) lastPush = lastActivity;

      const daysIdle = Math.max(0, Math.floor((now - lastActivity) / 86400e3));
      const bornDead = !repo.pushed_at || (lastActivity - createdAt) <= 24 * 3600e3;
      entries.push({
        name: repo.name,
        url: repo.html_url,
        createdAt,
        lastActivity,
        daysIdle,
        stars: repo.stargazers_count || 0,
        fate,
        stillborn: bornDead,
      });
      if (fate !== F_ALIVE) {
        starsStranded += repo.stargazers_count || 0;
        if (bornDead) stillborn++;
      }
    }
    const corpses = entries.filter((e) => e.fate !== F_ALIVE);

    corpses.sort((a, b) => b.daysIdle - a.daysIdle);
    const index = total === 0 ? 0 : Math.round((weightSum / total) * 100);

    return {
      subject,
      index,
      title: titleFor(index, total),
      flavor: flavorFor(index, total),
      counts,
      total,
      starsStranded,
      oldestCorpse: corpses[0] || null,
      stillborn,
      daysSinceAnyPush: lastPush ? Math.floor((now - lastPush) / 86400e3) : null,
      lowSample: total < 3,
      corpses,
      entries,
    };
  }

  // ---------- card ----------

  const W = 495, H = 195;
  const FONT = "-apple-system,'Segoe UI',Roboto,Ubuntu,Cantarell,'Noto Sans',Helvetica,Arial,sans-serif";

  const f1 = (v) => v.toFixed(1);

  function pt(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  }
  function pts(cx, cy, r, deg) {
    const [x, y] = pt(cx, cy, r, deg);
    return `${f1(x)},${f1(y)}`;
  }

  function hsl(h, s, l) {
    s = Math.min(100, Math.max(0, s)) / 100;
    l = Math.min(100, Math.max(0, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const xm = c * (1 - Math.abs((hp % 2) - 1));
    const [r, g, b] = (() => {
      switch (Math.floor(hp)) {
        case 0: return [c, xm, 0];
        case 1: return [xm, c, 0];
        case 2: return [0, c, xm];
        case 3: return [0, xm, c];
        case 4: return [xm, 0, c];
        default: return [c, 0, xm];
      }
    })();
    const m = l - c / 2;
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function palette(index) {
    const sat = Math.min(1, Math.max(0, (100 - index) / 100));
    return {
      bg: '#0d1117', border: '#30363d', text: '#e6edf3', dim: '#8b949e',
      accent: hsl(275, 75 * sat, 62),
      needle: index >= 60 ? '#d8d4c8' : hsl(350, 80 * sat + 10, 58),
      zones: [hsl(150, 70 * sat, 48), hsl(95, 65 * sat, 50), hsl(45, 85 * sat, 55), hsl(20, 85 * sat, 55), hsl(0, 75 * sat, 52)],
    };
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function gauge(index, p) {
    const cx = 95, cy = 132, r = 62;
    let g = '';
    for (let i = 0; i < 5; i++) {
      const a0 = 180 - i * 36, a1 = a0 - 34;
      g += `<path d="M ${pts(cx, cy, r, a0)} A ${r} ${r} 0 0 1 ${pts(cx, cy, r, a1)}" stroke="${p.zones[i]}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    }
    g += `<line x1="${cx - r - 8}" y1="${cy}" x2="${cx + r + 8}" y2="${cy}" stroke="${p.border}" stroke-width="1"/>`;
    g += `<text x="${cx - r - 2}" y="${cy + 14}" text-anchor="middle" font-size="9" fill="${p.dim}">0</text>`;
    g += `<text x="${cx + r + 2}" y="${cy + 14}" text-anchor="middle" font-size="9" fill="${p.dim}">&#9760;</text>`;
    // needle: swings in from the left (alive) end on load — SMIL, works in <img>
    const theta = 180 - index * 1.8;
    const swing = Math.max(30, 180 - theta); // at least a little drama
    g += `<g><animateTransform attributeName="transform" type="rotate" `
      + `values="-${swing.toFixed(1)} ${cx} ${cy};4 ${cx} ${cy};0 ${cx} ${cy}" `
      + `keyTimes="0;0.8;1" dur="1.1s" fill="freeze"/>`
      + `<polygon points="${pts(cx, cy, r - 12, theta)} ${pts(cx, cy, 4, theta + 90)} ${pts(cx, cy, 4, theta - 90)}" fill="${p.needle}"/>`
      + `<circle cx="${cx}" cy="${cy}" r="5.5" fill="${p.bg}" stroke="${p.needle}" stroke-width="1.5"/>`
      + `</g>`;
    g += `<text x="${cx}" y="${cy + 32}" text-anchor="middle" font-size="10" letter-spacing="2" fill="${p.dim}">NECROMETER</text>`;
    return g;
  }

  function stats(reading, p) {
    let s = '';
    const x = 200;
    s += `<text x="${x}" y="32" font-size="15" font-weight="600" fill="${p.text}">@${esc(reading.subject)}</text>`;
    if (reading.total === 0) {
      return s + `<text x="${x}" y="60" font-size="13" fill="${p.dim}">no repos — nothing to bury</text>`;
    }
    s += `<text x="${x}" y="70" font-size="34" font-weight="700" fill="${p.accent}">${reading.index}%</text>`;
    s += `<text x="${x + 78}" y="70" font-size="12" fill="${p.dim}">necrotic</text>`;
    s += `<text x="${x}" y="90" font-size="13" font-weight="600" fill="${p.accent}">${esc(reading.title)}</text>`;
    s += `<text x="${x}" y="105" font-size="10.5" font-style="italic" fill="${p.dim}">${esc(reading.flavor)}</text>`;

    const fateLine = reading.counts
      .map((n, i) => (n > 0 ? `${n} ${FATE_LABEL[i]}` : null))
      .filter(Boolean)
      .join(' · ');
    s += `<text x="${x}" y="126" font-size="11" fill="${p.text}">${esc(fateLine)}</text>`;

    let y = 143;
    if (reading.starsStranded > 0) {
      s += `<text x="${x}" y="${y}" font-size="11" fill="${p.dim}">${reading.starsStranded} stars stranded on dead repos</text>`;
      y += 15;
    }
    if (reading.oldestCorpse) {
      const name = reading.oldestCorpse.name.length > 20
        ? reading.oldestCorpse.name.slice(0, 19) + '…' : reading.oldestCorpse.name;
      s += `<text x="${x}" y="${y}" font-size="11" fill="${p.dim}">oldest corpse: ${esc(name)} (${reading.oldestCorpse.daysIdle}d)</text>`;
      y += 15;
    }
    const bits = [];
    if (reading.stillborn > 0) bits.push(`${reading.stillborn} stillborn`);
    if (reading.daysSinceAnyPush != null)
      bits.push(reading.daysSinceAnyPush === 0 ? 'signs of life today' : `last sign of life: ${reading.daysSinceAnyPush}d ago`);
    if (bits.length)
      s += `<text x="${x}" y="${y}" font-size="11" fill="${p.dim}">${esc(bits.join(' · '))}</text>`;

    s += ekg(reading.index, p);
    return s;
  }

  // Heartbeat strip under the stats — spiky when healthy, flatlines when dead.
  function ekg(index, p) {
    const x0 = 200, w = 235, base = 184;
    const amp = Math.max(0, 1 - index / 110); // 1 at 0%, ~0 at 100%
    const beats = index < 30 ? 4 : index < 60 ? 3 : index < 80 ? 2 : index < 90 ? 1 : 0;
    let d = `M ${x0},${base}`;
    let x = x0;
    const flat = () => { x += w / 12; d += ` L ${f1(x)},${base}`; };
    for (let i = 0; i < beats; i++) {
      const a = 12 * amp;
      x += w / 24; d += ` L ${f1(x)},${f1(base)}`;
      x += w / 48; d += ` L ${f1(x)},${f1(base - a * 0.4)}`;
      x += w / 48; d += ` L ${f1(x)},${f1(base - a)}`;
      x += w / 48; d += ` L ${f1(x)},${f1(base + a * 0.5)}`;
      x += w / 48; d += ` L ${f1(x)},${f1(base)}`;
      x += w / 16; d += ` L ${f1(x)},${f1(base)}`;
    }
    while (x < x0 + w) flat();
    const color = index >= 80 ? '#f85149' : p.accent;
    return `<path d="${d}" stroke="${color}" stroke-width="1.4" fill="none" `
      + `stroke-dasharray="900" stroke-dashoffset="0" opacity="0.85">`
      + `<animate attributeName="stroke-dashoffset" from="900" to="0" dur="1.6s" fill="freeze"/>`
      + `</path>`;
  }

  // ---------- lifelines chart ----------
  // Star-history, but for death: one line per repo, created_at -> last push.
  // Alive lines run off the right edge with a pulse; dead ones end in a grave tick.

  const FATE_COLOR = ['#3fb950', '#58a6ff', '#d29922', '#f85149', '#6e7681'];
  const TL_W = 495, TL_ROWS = 14, ROW_H = 15;
  const TL_X0 = 112, TL_X1 = 470, TL_TOP = 46;

  function renderTimeline(reading) {
    const rows = reading.entries
      .slice()
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, TL_ROWS);
    const height = TL_TOP + rows.length * ROW_H + 20;
    const t1 = Date.now();
    const t0 = Math.min(...rows.map((r) => r.createdAt), t1 - 1);
    const span = Math.max(1, t1 - t0);
    const x = (t) => TL_X0 + ((t - t0) / span) * (TL_X1 - TL_X0);
    const p = palette(reading.index);

    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${TL_W}" height="${height}" viewBox="0 0 ${TL_W} ${height}" font-family="${FONT}">`
      + `<rect width="${TL_W}" height="${height}" rx="6" fill="${p.bg}" stroke="${p.border}" stroke-width="1"/>`
      + `<text x="12" y="26" font-size="13" font-weight="600" fill="${p.text}">@${esc(reading.subject)} — lifelines</text>`
      + `<text x="${TL_W - 12}" y="26" text-anchor="end" font-size="13" font-weight="700" fill="${p.accent}">${reading.index}% necrotic</text>`;

    // time gridlines: 4 verticals + range labels
    for (let i = 0; i <= 4; i++) {
      const gx = TL_X0 + (i / 4) * (TL_X1 - TL_X0);
      s += `<line x1="${f1(gx)}" y1="${TL_TOP - 6}" x2="${f1(gx)}" y2="${TL_TOP + rows.length * ROW_H}" stroke="${p.border}" stroke-width="0.5" opacity="0.6"/>`;
    }
    s += `<text x="${TL_X0}" y="${TL_TOP - 10}" font-size="9" fill="${p.dim}">${new Date(t0).getFullYear()}</text>`
      + `<text x="${TL_X1}" y="${TL_TOP - 10}" text-anchor="end" font-size="9" fill="${p.dim}">now</text>`;

    rows.forEach((r, i) => {
      const y = TL_TOP + i * ROW_H + ROW_H / 2 + 2;
      const x0 = x(r.createdAt), x1 = x(r.lastActivity);
      const color = FATE_COLOR[r.fate];
      const delay = (i * 0.07).toFixed(2);
      const name = r.name.length > 15 ? r.name.slice(0, 14) + '…' : r.name;
      s += `<text x="8" y="${y + 3}" font-size="9" fill="${p.dim}">${esc(name)}</text>`;
      if (r.stillborn) {
        // diamond at birth — it never lived
        s += `<polygon points="${f1(x0)},${f1(y - 4)} ${f1(x0 + 4)},${f1(y)} ${f1(x0)},${f1(y + 4)} ${f1(x0 - 4)},${f1(y)}" fill="${color}" opacity="0.9"/>`;
        return;
      }
      s += `<line x1="${f1(x0)}" y1="${f1(y)}" x2="${f1(x1)}" y2="${f1(y)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round" `
        + `stroke-dasharray="400" stroke-dashoffset="0" opacity="0.9">`
        + `<animate attributeName="stroke-dashoffset" from="400" to="0" dur="0.7s" begin="${delay}s" fill="freeze"/>`
        + `</line>`;
      if (r.fate === 0) {
        // alive: pulsing dot at the right edge
        s += `<circle cx="${f1(x1)}" cy="${f1(y)}" r="3.2" fill="${color}">`
          + `<animate attributeName="opacity" values="1;0.25;1" dur="1.4s" begin="${delay}s" repeatCount="indefinite"/>`
          + `</circle>`;
      } else {
        // grave tick at the moment it died
        s += `<line x1="${f1(x1)}" y1="${f1(y - 4.5)}" x2="${f1(x1)}" y2="${f1(y + 4.5)}" stroke="${color}" stroke-width="1.6">`
          + `<animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="${delay}s" fill="freeze"/>`
          + `</line>`;
      }
    });

    s += `<text x="${TL_W - 10}" y="${height - 8}" text-anchor="end" font-size="10" fill="${p.dim}">necrometer.dev</text></svg>`;
    return s;
  }

  function easterEgg(index) {
    if (index === 0) {
      let e = `<circle cx="30" cy="30" r="7" fill="#ffd866"/>`;
      for (let i = 0; i < 8; i++) {
        const a = i * 45;
        const [x0, y0] = pt(30, 30, 10, a);
        const [x1, y1] = pt(30, 30, 15, a);
        e += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="#ffd866" stroke-width="1.5"/>`;
      }
      return e;
    }
    if (index >= 80) {
      return '<polyline points="60,75 72,95 66,110 80,128" stroke="#3a3f45" stroke-width="1.5" fill="none"/>'
        + '<polyline points="120,70 112,92 124,105 115,126" stroke="#3a3f45" stroke-width="1.2" fill="none"/>'
        + '<path d="M 470,10 Q 480,20 488,12 M 470,10 Q 478,28 470,36 M 470,10 L 488,36 M 470,10 A 24 24 0 0 1 488,36" stroke="#3a3f45" stroke-width="1" fill="none"/>';
    }
    return '';
  }

  function renderCard(reading) {
    const p = palette(reading.index);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`
      + `<rect width="${W}" height="${H}" rx="6" fill="${p.bg}" stroke="${p.border}" stroke-width="1"/>`
      + gauge(reading.index, p)
      + stats(reading, p)
      + easterEgg(reading.index)
      + `<text x="${W - 10}" y="${H - 8}" text-anchor="end" font-size="10" fill="${p.dim}">necrometer.dev</text>`
      + '</svg>';
  }

  return { fetchRepos, analyze, renderCard, renderTimeline, NotFound, Upstream, FATE_LABEL };
});

// ---------- node CLI ----------
// node necrometer.js <user-or-org> [out.svg]   (node >= 18)
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const { fetchRepos, analyze, renderCard, renderTimeline } = module.exports;
  const timeline = process.argv.includes('--timeline');
  const args = process.argv.slice(2).filter((a) => a !== '--timeline');
  const [name, out] = [args[0], args[1] || 'necrometer.svg'];
  if (!name) {
    console.error('usage: node necrometer.js <user-or-org> [out.svg] [--timeline]');
    process.exit(2);
  }
  (async () => {
    const token = process.env.NECRO_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const repos = await fetchRepos(name, null, token);
    const reading = analyze(name, repos);
    const svg = timeline ? renderTimeline(reading) : renderCard(reading);
    require('fs').writeFileSync(out, svg);
    console.log(`wrote ${out}`);
  })().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
