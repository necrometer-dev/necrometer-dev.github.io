#!/usr/bin/env node
// Drives the shipped wasm render path and the page CSP that #card needs.
// Fail if show() uses blob: but img-src does not allow it (the blank-card bug).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze_repos, initSync, render_card } from "../pkg/seance.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fail = (m) => {
  console.error("FAIL " + m);
  process.exit(1);
};

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cspM = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
if (!cspM) fail("index.html missing CSP meta");
const csp = cspM[1];
const imgSrc = (csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("img-src")) || "");
const siteJs = fs.readFileSync(path.join(root, "site.js"), "utf8");
const usesBlob = /createObjectURL\(\s*new Blob\(\s*\[\s*current\.svg/.test(siteJs)
  && /\$\('card'\)\.src\s*=\s*cardUrl/.test(siteJs);
if (!usesBlob) fail("site.js show() no longer assigns a blob URL to #card");
if (!/\bblob:/.test(imgSrc)) {
  fail("CSP img-src lacks blob: — #card will be a blank/broken frame. img-src=" + imgSrc);
}
if (html.includes("fonts.googleapis.com") || html.includes("fonts.gstatic.com")) {
  fail("Google Fonts still referenced; CSP will block them");
}
if (!/font-src 'self'/.test(csp)) fail("CSP missing font-src 'self'");
for (const f of ["creepster.woff2", "imfell.woff2", "imfell-italic.woff2", "vt323.woff2"]) {
  const p = path.join(root, "assets/fonts", f);
  if (!fs.existsSync(p)) fail("missing " + p);
}
if (!html.includes('id="card"')) fail("index.html missing #card");
if (!html.includes('id="result"')) fail("index.html missing #result");
if (!html.includes('id="f"')) fail("index.html missing form #f");

initSync({ module: fs.readFileSync(path.join(root, "pkg/seance_bg.wasm")) });
const now = new Date().toISOString();
const repos = JSON.stringify([
  {
    name: "alive",
    pushed_at: now,
    created_at: "2023-01-01T00:00:00Z",
    archived: false,
    fork: false,
    stargazers_count: 5,
    html_url: "https://github.com/ci/alive",
  },
]);
const readingJson = analyze_repos("ci", "user", repos);
if (!readingJson.startsWith("{")) fail("analyze_repos: " + readingJson.slice(0, 200));
const reading = JSON.parse(readingJson);
if (reading.subject !== "ci") fail("subject " + reading.subject);
const svg = render_card(readingJson);
if (!svg.startsWith("<svg")) fail("render_card did not return SVG: " + svg.slice(0, 80));
if (!svg.includes("</svg>")) fail("render_card SVG not closed");

console.log("ok csp img-src includes blob:");
console.log("ok show() uses blob URL on #card");
console.log("ok analyze_repos reading=" + readingJson.length + " index=" + reading.index);
console.log("ok render_card svg=" + svg.length);

const necroJs = fs.readFileSync(path.join(root, "necrometer.js"), "utf8");
if (necroJs.includes("require.main === module")) {
  fail("dead node CLI still in necrometer.js");
}
const vm = await import("node:vm");
const ctx = { module: { exports: {} }, exports: {}, self: undefined };
vm.createContext(ctx);
vm.runInContext(necroJs, ctx);
const K = ctx.module.exports.kindFromUserPayload;
if (typeof K !== "function") fail("kindFromUserPayload not exported");
if (K({ type: "Organization" }) !== "org") fail("org payload not org");
if (K({ type: "User" }) !== "user") fail("user payload not user");
const N = ctx.module.exports;
if (N.pagesNeeded(2900) !== 29) fail("pagesNeeded 2900 -> " + N.pagesNeeded(2900));
if (N.pagesNeeded(1) !== 1) fail("pagesNeeded 1");
if (!N.cannotAfford(10, 30)) fail("10 remaining cannot cover 30 pages");
if (N.cannotAfford(55, 30)) fail("55 remaining should cover 30 pages");
if (N.cannotAfford(null, 30)) fail("unknown remaining should not block");
const qm = N.quotaMessage("google", 2900, 12, Math.floor(Date.now() / 1000) + 900);
if (!/google/.test(qm) || !/~29/.test(qm) || !/12 left/.test(qm)) fail("quotaMessage: " + qm);
if (!html.includes('id="token"')) fail("index.html missing token field");
if (siteJs.includes("releases/latest")) fail("site.js still spends quota on releases/latest");
console.log("ok kindFromUserPayload org/user");
console.log("ok quota helpers google=29 pages, refuse at 10 remaining");
