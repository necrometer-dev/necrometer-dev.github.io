// site.js — census glue. Wires wasm, runs a search, paints #card.
// Loaded as <script src="site.js"> (CSP script-src 'self').
(async () => {
const $ = (id) => document.getElementById(id);
const status = (msg, isErr) => { $('status').textContent = msg; $('status').className = isErr ? 'err' : ''; };
let current = null, cardUrl = null;

let Engine = null;
try {
  const mod = await import('./pkg/seance.js');
  await mod.default('./pkg/seance_bg.wasm');
  Engine = {
    analyze: (name, kind, repos) => JSON.parse(mod.analyze_repos(name, kind, JSON.stringify(repos))),
    renderCard: (r) => mod.render_card(JSON.stringify(r)),
    engine: 'rust/wasm',
  };
} catch (e) {
  const msg = 'wasm engine failed to load: ' + (e.message || e) + ' — try refreshing';
  Engine = {
    analyze: () => { throw new Error(msg); },
    renderCard: () => { throw new Error('wasm engine failed to load'); },
    engine: 'broken',
  };
}

const RITES = ['rattling the coffins', 'reading the entrails', 'knocking on repo lids',
  'consulting the void', 'counting the maggots', 'checking for a pulse',
  'lighting the black candles', 'whispering to the dead', 'sharpening the scalpel'];
let riteTimer = null, dug = 0;
function startRites() {
  dug = 0; let i = 0;
  const tick = () => status(`${RITES[i++ % RITES.length]}…${dug ? ` — ${dug} bodies found` : ''}`);
  tick();
  riteTimer = setInterval(tick, 1100);
}
function stopRites() { clearInterval(riteTimer); riteTimer = null; }

const TOKEN_KEY = 'necrometer.token';
const CACHE_MS = 30 * 60 * 1000;
function token() {
  const el = $('token');
  const typed = el && el.value.trim();
  if (typed) return typed;
  try { return sessionStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
}
function rememberToken() {
  const el = $('token');
  if (!el) return;
  const v = el.value.trim();
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (_) { /* private mode */ }
}
function cacheKey(name) { return 'necrometer.reading.' + name.toLowerCase(); }
function cacheGet(name) {
  try {
    const o = JSON.parse(sessionStorage.getItem(cacheKey(name)));
    if (!o || !o.reading || Date.now() - o.t > CACHE_MS) return null;
    return o.reading;
  } catch (_) { return null; }
}
function cachePut(name, reading) {
  try { sessionStorage.setItem(cacheKey(name), JSON.stringify({ t: Date.now(), reading })); }
  catch (_) { /* quota */ }
}

async function run(name) {
  name = name.trim().replace(/^@/, '');
  if (!name) return;
  $('result').style.display = 'none';
  const tok = token();
  const hit = cacheGet(name);
  if (hit) {
    current = { r: hit, svg: Engine.renderCard(hit) };
    show(hit);
    status('cached reading — GitHub not contacted');
    history.replaceState(null, '', '?u=' + encodeURIComponent(name));
    return;
  }
  startRites();
  try {
    const resolved = await Necrometer.detectKind(name, tok);
    const { kind, repos } = await Necrometer.fetchRepos(name, resolved, (n) => { dug += n; }, tok);
    const r = Engine.analyze(name, kind, repos);
    current = { r, svg: Engine.renderCard(r) };
    cachePut(name, r);
    show(r);
    status('');
    history.replaceState(null, '', '?u=' + encodeURIComponent(name));
  } catch (e) {
    const msg = e.message || String(e);
    status(msg, true);
    if (/rate limit|API calls/i.test(msg)) {
      const box = $('token-box');
      if (box) box.open = true;
    }
  } finally {
    stopRites();
  }
}

function show(r) {
  if (cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = URL.createObjectURL(new Blob([current.svg], { type: 'image/svg+xml' }));
  $('card').src = cardUrl;
  $('summary').textContent = r.total === 0
    ? 'no repos — nothing to bury'
    : `${r.index}% necrotic — ${r.title} · ${r.total} souls · ${r.starsStranded} stars stranded`;
  $('snippet').textContent =
    `[![Necrometer](necrometer.svg)](https://necrometer.dev/?u=${encodeURIComponent(r.subject)})`;
  $('workflow').textContent = window.NecroChrome.workflow();
  const shareText = r.total === 0
    ? `💀 Examined @${r.subject} on the necrometer — no repos found, nothing to bury.`
    : `💀 @${r.subject} is ${r.index}% necrotic ("${r.title}") on the necrometer. How dead are your repos?`;
  const shareUrl = `https://necrometer.dev/?u=${encodeURIComponent(r.subject)}`;
  $('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
  $('result').style.display = 'block';
}

$('f').addEventListener('submit', (e) => { e.preventDefault(); rememberToken(); run($('subject').value); });
if ($('token')) {
  try {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) { $('token').value = saved; $('token-box').open = true; }
  } catch (_) { /* private mode */ }
  $('token').addEventListener('change', rememberToken);
}

window.NecroChrome.boot({ status, getCurrent: () => current });
const u = new URLSearchParams(location.search).get('u');
if (u) { $('subject').value = u; run(u); }
})();
