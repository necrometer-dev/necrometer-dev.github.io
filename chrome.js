// chrome.js — ticker, copy/share, install-rite text. Not the census.
(function (w) {
  const $ = (id) => document.getElementById(id);

  const workflow = () => `name: necrometer
on:
  schedule: [{cron: "17 6 * * *"}]   # daily
  workflow_dispatch:                  # manual "run now" — does NOT run on push
permissions: { contents: write }
jobs:
  necrometer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: necrometer-dev/necrometer-action@v1
        with:
          # GITHUB_TOKEN covers the current repo and the owner's own private
          # repos. For an org's other private repos, add a NECRO_TOKEN secret
          # (fine-grained PAT, org-approved).
          token: \${{ secrets.NECRO_TOKEN || secrets.GITHUB_TOKEN }}`;

  const AGENT_RITE = `Add a necrometer card to this repository. Follow https://necrometer.dev/agents.md exactly.

1. Create .github/workflows/necrometer.yml with EXACTLY this content:

${workflow()}

Do not add a release: input, do not change runs-on, do not set persist-credentials: false.

2. Add this line to the root README.md, near the title (replace OWNER with \`gh repo view --json owner -q .owner.login\`):

[![Necrometer](necrometer.svg)](https://necrometer.dev/?u=OWNER)

3. Commit both files on the default branch and push. workflow_dispatch does NOT run on push — trigger it:

gh workflow run necrometer
gh run watch --exit-status
git pull

Do NOT create necrometer.svg by hand. The action generates and commits it (necrometer[bot]). If checksum verification fails, stop and report it. Full rite: https://necrometer.dev/agents.md`;

  function svgToPngBlob(svg, scale) {
    scale = scale || 2;
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

  function wireTicker() {
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
  }

  function boot(opts) {
    const status = opts.status;
    const getCurrent = opts.getCurrent;
    const copier = (el) => () => navigator.clipboard.writeText(el.textContent).then(() => status('copied — go carve it'));
    $('copy').addEventListener('click', copier($('snippet')));
    $('copywf').addEventListener('click', copier($('workflow')));
    $('copyag').addEventListener('click', copier($('agentrite')));
    $('agentrite').textContent = AGENT_RITE;
    $('copycard').addEventListener('click', async () => {
      const current = getCurrent();
      if (!current || !current.svg) return;
      try {
        status('rendering card image…');
        const blob = await svgToPngBlob(current.svg, 2);
        if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          status('card image copied to clipboard — paste into 𝕏 with Ctrl+V');
        } else {
          status('clipboard image not supported in this browser', true);
        }
      } catch (err) {
        status('could not copy image: ' + (err.message || err), true);
      }
    });
    wireTicker();
  }

  w.NecroChrome = { workflow, boot };
})(window);
