<div align="center">

# ☠ necrometer.dev

**the instrument itself — a static site that judges the dead.**

[![Necrometer](necrometer.svg)](https://necrometer.dev/?u=necrometer-dev)

### → [necrometer.dev](https://necrometer.dev) ←

</div>

---

This repo *is* the website. Static GitHub Pages — there is no backend, no
database, no per-user image hosting. Everything happens in the visitor's
browser:

1. `necrometer.js` fetches repos straight from `api.github.com` (CORS-allowed,
   parallel pagination)
2. the **Rust/WASM engine** (`pkg/`, built from
   [necrometer-dev/necrometer](https://github.com/necrometer-dev/necrometer))
   analyzes the bodies and renders the card — pure JS fallback if wasm fails
3. you copy a **workflow** — three lines calling
   [`necrometer-dev/necrometer-action`](https://github.com/necrometer-dev/necrometer-action),
   which downloads the pinned, checksum-verified release binary and re-commits
   `necrometer.svg` to *your* repo daily. GitHub runs the compute; we host
   nothing.

## the ticker

The tape under the logo reads `hall.json` — a weekly census of popular,
currently-active orgs (vercel, openai, rust-lang, kubernetes, …). `hall.txt`
is the input list; `.github/workflows/hall.yml` regenerates the JSON every
Monday with the release binary.

## files

```
index.html       the whole page — haunted CRT, fonts, ritual logic
necrometer.js    GitHub fetch + quota (analysis/render is wasm)
chrome.js        ticker, copy/share, install-rite text
site.js          wasm glue + search → #card
pkg/             wasm build of the Rust engine (generated — don't edit)
agents.md        the install rite, written for coding agents to fetch
hall.txt         names for the weekly census
hall.json        generated ticker data
assets/          brand — skull icon + og banner (svg sources too)
necrometer.svg   this org's own card (kept fresh by necrometer.yml)
CNAME            necrometer.dev
```

---

<div align="center">
<sub>put in a name. get a reading. bind the card to your README.</sub>
</div>
