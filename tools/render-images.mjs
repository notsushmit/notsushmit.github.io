// Renders the share image and PNG favicons with Playwright. Authoring tool only.
// Playwright is not a site dependency: run this from a folder where it is installed,
//   cd <folder with node_modules/playwright> && node /path/to/tools/render-images.mjs
// It drives the locally installed Chrome (channel "chrome"), so no browser download is needed.
// Outputs: assets/og.png (1200x630), assets/favicon-32.png, assets/apple-touch-icon.png (180x180).
// assets/favicon.svg is written by tools/build.mjs from design/doodles/mascot-face.svg.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(path.join(process.cwd(), "noop.js"));
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const browser = await chromium.launch({ channel: "chrome" });

// share card
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.goto(url("tools/og.html"));
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: path.join(ROOT, "assets/og.png") });

// favicons from the mascot face
const face = fs.readFileSync(path.join(ROOT, "design/doodles/mascot-face.svg"), "utf8");
for (const [file, size, bg, pad] of [["favicon-32.png", 32, "transparent", 0], ["apple-touch-icon.png", 180, "#F1EEE6", 18]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center">
    <div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${face.replace("<svg ", '<svg style="width:100%;height:100%" ')}</div></body></html>`);
  await page.screenshot({ path: path.join(ROOT, "assets", file), omitBackground: bg === "transparent" });
}

await browser.close();
for (const f of ["og.png", "favicon-32.png", "apple-touch-icon.png"]) {
  console.log(f, Math.round(fs.statSync(path.join(ROOT, "assets", f)).size / 1024) + "KB");
}
