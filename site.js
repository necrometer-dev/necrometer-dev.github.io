// site.js — page glue. Wires the wasm engine, runs the ticker, handles share.
// Loaded as <script src="site.js"> to satisfy the page's strict CSP
// (`script-src 'self'`); no inline scripts, no eval.
(async () => {
const $ = (id) => document.getElementById(id);
const status = (msg, isErr) => { $('status').textContent = msg; $('status').className = isErr ? 'err' : ''; };
let current = null, cardUrl = null;

// Fetch is JS-side (browser-native CORS); the necromancy runs in wasm.
// necrometer.js only exposes fetchRepos — no pure-JS analyze/renderCard.
let Engine = null;
try {
  const mod = await import('./pkg/seance.js');
  await mod.default('./pkg/seance_bg.wasm');
  Engine = {
    analyze: (name, repos) => JSON.parse(mod.analyze_repos(name, JSON.stringify(repos))),
    renderCard: (r) => mod.render_card(JSON.stringify(r)),
    engine: 'rust/wasm',
  };
} catch (e) {
  // Surface the error rather than silently breaking the form.
  const msg = 'wasm engine failed to load: ' + (e.message || e) + ' — try refreshing';
  Engine = {
    analyze: () => { throw new Error(msg); },
    renderCard: () => { throw new Error('wasm engine failed to load'); },
    engine: 'broken',
  };
}

const WORKFLOW = () => `name: necrometer
on:
  schedule: [{cron: "17 6 * * *"}]   # daily
  workflow_dispatch:                  # manual "run now" — also runs on first push
permissions: { contents: write }
jobs:
  necrometer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: necrometer-dev/necrometer-action@v1
        with:
          # GITHUB_TOKEN covers your own private repos. For an org with private
          # repos you don't own, add a NECRO_TOKEN secret (fine-grained PAT).
          token: \${{ secrets.NECRO_TOKEN || secrets.GITHUB_TOKEN }}`;

const AGENT_RITE = `Add a necrometer card to this repository.

1. Create .github/workflows/necrometer.yml with EXACTLY this content:

${WORKFLOW()}

2. Add this line to README.md, just under the title:

[![Necrometer](necrometer.svg)](https://necrometer.dev/?u=OWNER)

Replace OWNER with the repository owner's GitHub login (gh repo view --json owner -q .owner.login).

3. Commit both files on the default branch and push, then trigger the workflow once (gh workflow run necrometer, or the Actions tab) so the card appears immediately. It re-carves daily after that.

Rules: do NOT create necrometer.svg by hand — the action generates it. The action summons a pinned release binary and SHA256-verifies it before running; do not modify or replace its steps. If the repo needs private-org visibility, add a NECRO_TOKEN secret (fine-grained PAT, repo read). Full rite: https://necrometer.dev/agents.md`;

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

async function run(name) {
  name = name.trim().replace(/^@/, '');
  if (!name) return;
  $('result').style.display = 'none';
  startRites();
  try {
    const repos = await Necrometer.fetchRepos(name, (n) => { dug += n; });
    const r = Engine.analyze(name, repos);
    current = { r, svg: Engine.renderCard(r) };
    show(r);
    status('');
    history.replaceState(null, '', '?u=' + encodeURIComponent(name));
  } catch (e) {
    status(e.message || String(e), true);
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
  $('workflow').textContent = WORKFLOW(r.subject);

  const shareText = r.total === 0
    ? `💀 Examined @${r.subject} on the necrometer — no repos found, nothing to bury.`
    : `💀 @${r.subject} is ${r.index}% necrotic ("${r.title}") on the necrometer. How dead are your repos?`;
  const shareUrl = `https://necrometer.dev/?u=${encodeURIComponent(r.subject)}`;
  $('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

  $('result').style.display = 'block';
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

$('f').addEventListener('submit', (e) => { e.preventDefault(); run($('subject').value); });
const copier = (el) => () => navigator.clipboard.writeText(el.textContent).then(() => status('copied — go carve it'));
$('copy').addEventListener('click', copier($('snippet')));
$('copywf').addEventListener('click', copier($('workflow')));
$('copyag').addEventListener('click', copier($('agentrite')));
$('agentrite').textContent = AGENT_RITE;

// Strip SMIL animations so the rasterized card renders in its resting state
// (needle at true position, EKG fully drawn, heart at full opacity).
function svgToPngBlob(svg, scale = 2) {
  const staticSvg = svg.replace(/<animateTransform[\s\S]*?\/>/gi, '').replace(/<animate[\s\S]*?\/>/gi, '');
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([staticSvg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 495 * scale; canvas.height = 195 * scale;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/png');
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to rasterize card SVG')); };
    img.src = url;
  });
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const filenameFor = (ext) => `necrometer-${(current && current.r && current.r.subject) || 'card'}.${ext}`;

$('copycard').addEventListener('click', async () => {
  if (!current || !current.svg) return;
  try {
    status('rendering card image…');
    const blob = await svgToPngBlob(current.svg, 2);
    if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      status('card image copied to clipboard — paste into 𝕏 with Ctrl+V');
    } else {
      downloadBlob(blob, filenameFor('png'));
      status('clipboard image not supported — downloaded PNG instead');
    }
  } catch (err) {
    status('could not copy image — downloading PNG instead', true);
    try { downloadBlob(await svgToPngBlob(current.svg, 2), filenameFor('png')); }
    catch (e) { status('image render failed: ' + (e.message || e), true); }
  }
});

$('downloadcard').addEventListener('click', async () => {
  if (!current || !current.svg) return;
  try {
    status('rendering card image…');
    downloadBlob(await svgToPngBlob(current.svg, 2), filenameFor('png'));
    status('card downloaded as PNG');
  } catch (err) { status('download failed: ' + (err.message || err), true); }
});

$('downloadsvg').addEventListener('click', () => {
  if (!current || !current.svg) return;
  downloadBlob(new Blob([current.svg], { type: 'image/svg+xml;charset=utf-8' }), filenameFor('svg'));
  status('card downloaded as SVG');
});

const u = new URLSearchParams(location.search).get('u');
if (u) { $('subject').value = u; run(u); }

// corpse ticker — static hall.json regenerated weekly by an Action in this repo.
fetch('hall.json').then((r) => r.ok ? r.json() : Promise.reject()).then((hall) => {
  const cls = (h) => h.index >= 80 ? 'doomed' : h.index < 15 ? 'hale' : '';
  const buildTape = () => {
    const frag = document.createDocumentFragment();
    for (const h of hall) {
      const a = document.createElement('a');
      a.href = '?u=' + encodeURIComponent(h.name);
      a.className = cls(h);
      a.appendChild(document.createTextNode('☠ '));
      a.appendChild(document.createTextNode(h.name));
      a.appendChild(document.createTextNode(' '));
      const sp = document.createElement('span');
      sp.className = 'ix';
      sp.textContent = h.index + '%';
      a.appendChild(sp);
      frag.appendChild(a);
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '·';
      frag.appendChild(sep);
    }
    return frag;
  };
  $('tape1').replaceChildren(buildTape());
  $('tape2').replaceChildren(buildTape());
  $('ticker').style.display = 'block';
}).catch(() => { /* the tape stays hidden */ });

// Latest release badge (footer bottom-right). Silent on any failure
// so a rate-limit or GH hiccup never blocks the page.
const REL = document.getElementById('rel');
if (REL) {
  fetch('https://api.github.com/repos/necrometer-dev/necrometer/releases/latest',
       { headers: { 'Accept': 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (!j || !j.tag_name) return;
      REL.textContent = 'engine ' + j.tag_name.replace(/^v/, '');
      REL.href = j.html_url || REL.href;
      REL.hidden = false;
    })
    .catch(() => { /* leave the badge hidden */ });
}
})();
