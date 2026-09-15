#!/usr/bin/env node
// Headless: serve the site, mock GitHub, submit a username, assert #card painted.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scratch = process.env.NECRO_SCRATCH || ".";
const shot = path.join(scratch, "card.png");
const logPath = path.join(scratch, "card-launch.txt");
const log = [];
const say = (s) => { log.push(s); console.log(s); };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      let p = path.normalize(u.pathname);
      if (p === "/") p = "/index.html";
      const file = path.join(root, p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    "playwright",
    "/home/jeryd/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js",
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error("playwright module not found");
}

const fixture = [{
  name: "alive",
  pushed_at: new Date().toISOString(),
  created_at: "2023-01-01T00:00:00Z",
  archived: false,
  fork: false,
  stargazers_count: 5,
  html_url: "https://github.com/ci/alive",
}];

async function runOnce(chromium, origin, pass) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const ignore = (s) => /frame-ancestors is ignored when delivered via a <meta>/.test(s);
  page.on("pageerror", (e) => { if (!ignore(String(e))) errors.push(String(e)); });
  page.on("console", (m) => {
    if (m.type() === "error" && !ignore(m.text())) errors.push(m.text());
  });
  await page.route("https://api.github.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rate_limit")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ resources: { core: { remaining: 60, reset: Math.floor(Date.now() / 1000) + 3600 } } }),
      });
      return;
    }
    if (/\/users\/[^/]+$/.test(new URL(url).pathname)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ login: "ci-user", type: "User", public_repos: 1 }),
      });
      return;
    }
    if (url.includes("/repos")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture),
      });
      return;
    }
    if (url.includes("/releases/latest")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tag_name: "v0.4.5", html_url: "https://github.com/necrometer-dev/necrometer/releases/tag/v0.4.5" }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(origin + "/?u=ci-user", { waitUntil: "networkidle" });
  await page.waitForSelector("#result", { state: "visible", timeout: 20000 });
  const card = await page.waitForSelector("#card", { timeout: 20000 });
  await page.waitForFunction(() => {
    const img = document.getElementById("card");
    return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  }, null, { timeout: 20000 });
  const box = await card.boundingBox();
  const src = await card.getAttribute("src");
  const display = await page.$eval("#result", (el) => getComputedStyle(el).display);
  if (display === "none") throw new Error("#result still display:none");
  if (!src || !src.startsWith("blob:")) throw new Error("#card src not blob: " + src);
  if (!box || box.width < 100 || box.height < 40) {
    throw new Error("card box too small " + JSON.stringify(box));
  }
  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  await page.screenshot({ path: shot, fullPage: true });
  await browser.close();
  say("pass " + pass + " result=visible card=" + Math.round(box.width) + "x" + Math.round(box.height) + " src=" + src.slice(0, 24) + " shot=" + shot);
}

const srv = await serve();
const { port } = srv.address();
const origin = "http://127.0.0.1:" + port;
say("serving " + root + " at " + origin);
try {
  const { chromium } = loadPlaywright();
  await runOnce(chromium, origin, 1);
  await runOnce(chromium, origin, 2);
  fs.writeFileSync(logPath, log.join("\n") + "\n");
  say("ok two launches painted #card");
} catch (e) {
  fs.writeFileSync(logPath, log.join("\n") + "\nERROR " + e.stack + "\n");
  console.error(e);
  process.exit(1);
} finally {
  srv.close();
}
