// Builds index.html from content/content.json. Authoring tool only: the site is the
// committed index.html, plain static HTML with no client-side rendering.
// Usage: node tools/build.mjs
// Output is deterministic: no timestamps, stable ordering, image sizes read from the files.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const c = JSON.parse(fs.readFileSync(path.join(ROOT, "content/content.json"), "utf8"));

/* ---------- helpers ---------- */
const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
// Site paths in content.json are root-absolute; emit them relative so the page also
// works from a subfolder or file://. External URLs, anchors and mailto pass through.
const href = (h) => (h.startsWith("/") ? h.slice(1) : h);
const isExternal = (h) => /^https?:\/\//.test(h);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const indent = (s, n) => s.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");
const hidden = (s) => `<span class="visually-hidden">${esc(s)}</span>`;

function imageSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, href(rel)));
  if (buf.toString("ascii", 1, 4) === "PNG") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // JPEG: walk the markers to the start-of-frame segment
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error(`cannot read size of ${rel}`);
}

const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function time(label) {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label);
  return m ? `<time datetime="${m[2]}-${MONTHS[m[1]]}">${esc(label)}</time>` : esc(label);
}

/* ---------- sections ---------- */
// The full doodle library lives in design/doodles (made by tools/doodles.mjs). Paths are
// rewritten as relative commands: same 1-decimal points, so the drawing is identical.
const LIB = path.join(ROOT, "design/doodles");
if (!fs.existsSync(LIB)) throw new Error("design/doodles is missing: run node tools/doodles.mjs first");
const fmt = (v) => { const r = Math.round(v * 10) / 10; return (Object.is(r, -0) ? 0 : r).toString().replace(/^(-?)0\./, "$1."); };
function joinNums(nums) {
  let out = "";
  for (const n of nums) {
    if (out && !n.startsWith("-") && !(n.startsWith(".") && /\.\d*$/.test(out.split(/[ -]/).pop()))) out += " ";
    out += n;
  }
  return out;
}
function minifyPath(d) {
  const tokens = d.match(/[MCZ]|-?\d*\.?\d+/g);
  if (!tokens || tokens.join("").length < d.replace(/\s/g, "").length - 2) return d;
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, out = "", last = "";
  const num = () => Math.round(parseFloat(tokens[i++]) * 10);
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === "M") { const x = num(), y = num(); out += (out ? "M" : "M") + joinNums([fmt(x / 10), fmt(y / 10)]); cx = sx = x; cy = sy = y; last = "M"; }
    else if (t === "C") {
      const v = [num(), num(), num(), num(), num(), num()];
      const rel = [v[0] - cx, v[1] - cy, v[2] - cx, v[3] - cy, v[4] - cx, v[5] - cy].map((n) => fmt(n / 10));
      const body = joinNums(rel);
      out += last === "c" ? (body.startsWith("-") ? body : " " + body) : "c" + body;
      cx = v[4]; cy = v[5]; last = "c";
    } else if (t === "Z") { out += "Z"; cx = sx; cy = sy; last = "Z"; }
    else return d; // unexpected command: leave the path untouched
  }
  return out;
}
const minified = {};
function libSvg(name) {
  if (!minified[name]) {
    const src = fs.readFileSync(path.join(LIB, `${name}.svg`), "utf8");
    minified[name] = src.replace(/ d="([^"]+)"/g, (_, d) => ` d="${minifyPath(d)}"`);
  }
  return minified[name];
}
function svgSize(rel) {
  const name = path.basename(rel, ".svg");
  const s = libSvg(name);
  const m = /<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(s);
  if (!m) throw new Error(`no size on ${rel}`);
  return { w: +m[1], h: +m[2], src: s };
}
// Decorative inline SVG: hidden from assistive tech, not focusable.
// Inline copies share one CSS class for the ink stroke instead of repeating six attributes.
const INK = ' fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"';
function inlineSvg(rel) {
  return svgSize(rel).src.trim().split(INK).join(' class="ink"')
    .replace(/\s*role="img"\s*aria-label="[^"]*"/, ' aria-hidden="true" focusable="false"')
    .replace(/\n\s*/g, "\n");
}
const navItems = (nav) => nav.map((n) =>
  `<li><a href="${esc(href(n.href))}">${esc(n.label)}${n.href.endsWith(".pdf") ? hidden(" (PDF)") : ""}</a></li>`).join("\n");

// Desktop: a plain list. Below 800px: a Menu button opening a native popover panel.
const header = () => `<header class="site-header" id="top">
  <div class="site-header__inner">
    <a class="wordmark" href="#top">${esc(c.meta.name)}</a>
    <nav class="site-nav" aria-label="Primary">
      <ul class="nav-list">
${indent(navItems(c.nav), 8)}
      </ul>
      <button type="button" class="button menu-button" popovertarget="nav-panel">Menu</button>
      <div id="nav-panel" class="nav-panel card" popover>
        <button type="button" class="nav-close" popovertarget="nav-panel" popovertargetaction="hide">Close</button>
        <ul>
${indent(navItems(c.nav), 10)}
        </ul>
      </div>
    </nav>
  </div>
</header>`;

// Hero scene. Positions are % of the scene box (6:5). Everything here is decorative.
const SCENE = [
  { cls: "blob", file: "blob-sky.svg", x: 13, y: 46, w: 30 },
  { cls: "blob", file: "blob-mustard.svg", x: 74, y: 66, w: 16 },
  { cls: "doodle", file: "sunburst.svg", x: 3, y: 3, w: 13 },
  { cls: "doodle", file: "sparkle.svg", x: 25, y: 17, w: 5, r: 10 },
  { cls: "doodle", file: "flower.svg", x: 49, y: 4, w: 7, r: -12 },
  { cls: "doodle", file: "cloud.svg", x: 76, y: 7, w: 18 },
  { cls: "doodle", file: "star.svg", x: 90, y: 33, w: 7, r: 14 },
  { cls: "doodle", file: "heart.svg", x: 89, y: 57, w: 5.5, r: -10 },
  { cls: "doodle", file: "squiggle.svg", x: 1, y: 74, w: 15, r: -6 },
  { cls: "doodle", file: "dots-dashes.svg", x: 56, y: 95, w: 22 },
  { cls: "ground", file: "ground-line.svg", x: 0, y: 87, w: 100 },
  { cls: "mascot", file: "mascot-dish.svg", x: 24, y: 39.7, w: 44, inline: true },
  { cls: "cat", file: "cat-loaf.svg", x: 67, y: 71.4, w: 28 },
  { cls: "doodle", file: "arrow.svg", x: 9, y: 41, w: 13, r: 8 },
];

function scene() {
  const items = SCENE.map((it) => {
    const rel = `assets/doodles/${it.file}`;
    const style = `--x:${it.x}%;--y:${it.y}%;--w:${it.w}%${it.r ? `;--r:${it.r}deg` : ""}`;
    if (it.inline) return `<div class="${it.cls}" data-asset="${it.file.replace(".svg", "")}" style="${style}">\n${inlineSvg(rel)}\n</div>`;
    const { w, h } = svgSize(rel);
    return `<img class="${it.cls}" style="${style}" src="${rel}" width="${w}" height="${h}" alt="" aria-hidden="true">`;
  });
  items.push(`<span class="annotation hand" style="--x:4%;--y:49%;--r:-8deg">${esc(c.hero.annotation)}</span>`);
  return `<div class="hero__scene" aria-hidden="true">
${indent(items.join("\n"), 2)}
</div>`;
}

const hero = () => `<section id="hero" class="hero" aria-labelledby="hero-title">
  <div class="hero__text">
    <h1 id="hero-title">${esc(c.hero.greeting)}</h1>
    <p class="tagline">${esc(c.hero.tagline)}</p>
${indent(sayHi(c.hero.cta), 4)}
  </div>
${indent(scene(), 2)}
</section>`;

// Native popover: no JavaScript. The invoker button gets its expanded state from the
// browser (popovertarget exposes aria-expanded), and the menu sits right after the
// button in the DOM so Tab moves from the button straight into the links.
function sayHi(cta) {
  const id = "say-hi-menu";
  return `<div class="say-hi">
  <button type="button" class="button" popovertarget="${id}">${esc(cta.label)}</button>
  <div id="${id}" class="say-hi-menu card" popover>
    <ul>
${cta.menu.map((l) => `      <li><a href="${esc(href(l.href))}"${l.newTab ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(l.label)}${l.newTab ? hidden(" (opens in a new tab)") : ""}</a></li>`).join("\n")}
    </ul>
  </div>
</div>`;
}

/* ---------- decoration helpers ---------- */
// Every doodle placed on the page goes through these, and the build checks the totals.
const DOODLE = (f) => `assets/doodles/${f}.svg`;
function viewBox(file) {
  const s = svgSize(DOODLE(file)).src;
  const [x, y, w, h] = /viewBox="([^"]+)"/.exec(s)[1].split(/\s+/).map(Number);
  return { x, y, w, h };
}
// Where each character touches the ground, in its own drawing coordinates.
const FOOT = {
  "mascot-waving": 887, "mascot-celebrating": 887, "mascot-thinking": 887, "mascot-magnifier": 887,
  "mascot-peeking": 614, "cat-sitting": 537, "cat-walking": 402, "cat-curled": 392, "cat-stretching": 400,
};
let floatN = 0;
// A small decorative image. x is % of the layer, y px from its top, w px.
function deco(file, { x, y, w, r = 0, cls = "", still = false }) {
  const { w: vw, h: vh } = svgSize(DOODLE(file));
  const n = floatN++;
  const anim = still ? "" : `;--dur:${7 + (n * 7) % 5}s;--delay:-${(n * 13) % 9}s`;
  return `<img class="deco${cls ? " " + cls : ""}" style="--x:${x}%;--y:${y}px;--w:${w}px${r ? `;--r:${r}deg` : ""}${anim}" src="${DOODLE(file)}" width="${vw}" height="${vh}" loading="lazy" decoding="async" alt="" aria-hidden="true">`;
}
// A character standing on a ground line: its feet sit on the element's bottom edge.
function grounded(file, { left, width, cls = "", inline = false }) {
  const vb = viewBox(file);
  const fo = ((vb.y + vb.h - FOOT[file]) / vb.h * 100).toFixed(2);
  const style = `--left:${left};--width:${width};--fo:${fo}%`;
  if (inline) return `<div class="grounded ${cls}" data-asset="${file}" style="${style}">\n${inlineSvg(DOODLE(file))}\n</div>`;
  const { w, h } = svgSize(DOODLE(file));
  return `<img class="grounded ${cls}" style="${style}" src="${DOODLE(file)}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="" aria-hidden="true">`;
}
// A character placed in normal flow (asides, heading rows).
function figureArt(file, cls) {
  const { w, h } = svgSize(DOODLE(file));
  return `<img class="${cls}" src="${DOODLE(file)}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="" aria-hidden="true">`;
}
const ground = (file = "ground-line") => {
  const { w, h } = svgSize(DOODLE(file));
  return `<img class="ground-line" src="${DOODLE(file)}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="" aria-hidden="true">`;
};

// Doodles around each section heading. m: also shown on phones (kept to the right edge).
const HEAD_DECOR = {
  work: [["blob-mustard", 58, 2, 110, 0], ["satellite", 60, 6, 72, -10, "m"], ["planet", 80, 26, 56, 8], ["sparkle", 44, 40, 30, 12]],
  "how-i-work": [["check", 52, 18, 50, -6], ["asterisk", 70, 2, 38, 0, "m"], ["triangle", 86, 30, 44, 10]],
  skills: [["blob-green", 64, 4, 96, 0], ["plus", 66, 14, 46, 12, "m"], ["leaf", 82, 0, 48, -14], ["zigzag", 46, 36, 70, -4]],
  experience: [["bolt", 50, 6, 44, 10], ["moon", 70, 24, 52, -8, "m"], ["ring", 88, 2, 40, 0]],
  recognition: [["star", 40, 8, 40, 14], ["emphasis", 52, 30, 46, -6]],
  about: [["blob-sky", 66, 0, 104, 0], ["heart", 70, 16, 42, -10, "m"], ["spiral", 50, 30, 48, 0], ["raindrop", 86, 2, 34, 8]],
  contact: [["blob-mustard-2", 4, 14, 96, 0], ["cloud", 8, 22, 78, 0], ["diamond", 86, 34, 40, 10], ["loops", 70, 0, 90, -6, "m"]],
};
function sectionHead(id, title, extra = "") {
  const items = (HEAD_DECOR[id] || []).map(([f, x, y, w, r, m]) =>
    deco(f, { x, y, w, r, cls: (f.startsWith("blob") ? "deco--blob " : "") + (m ? "deco--m" : "deco--wide"), still: f.startsWith("blob") }));
  return `<div class="section-head">
  <h2 id="${id}-title">${esc(title)}</h2>${extra ? `\n  ${extra}` : ""}
  <div class="decor" aria-hidden="true">
${indent(items.join("\n"), 4)}
  </div>
</div>`;
}

// Gutter clusters: shown in the side gutters on wide screens. inline: below 1100px
// the same cluster turns into a small centred row, so no doodle is placed twice.
function gutter(side, top, items, inline = false) {
  return `<div class="gutter gutter--${side}${inline ? " gutter--inline" : ""}" style="--top:${top}" aria-hidden="true">
${indent(items.map(([f, x, y, w, r]) => deco(f, { x, y, w, r, cls: f.startsWith("blob") ? "deco--blob" : "", still: f.startsWith("blob") })).join("\n"), 2)}
</div>`;
}

/* ---------- sections ---------- */
// Screenshot that opens a larger view on click: a native popover, no JavaScript.
// Escape or a click outside closes it; the enlarged view also links to the full file.
function picture(src, w, h, alt) {
  const webp = src.replace(/\.(jpe?g|png)$/, ".webp");
  return `<picture>
  <source type="image/webp" srcset="${webp}">
  <img src="${src}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="${esc(alt)}">
</picture>`;
}
function figure(s, id) {
  const { w, h } = imageSize(s.src);
  const src = esc(href(s.src));
  return `<figure>
  <button type="button" class="shot" popovertarget="${id}">
${indent(picture(src, w, h, s.alt), 4)}${hidden(" (enlarge)")}
  </button>${s.caption ? `
  <figcaption>${esc(s.caption)}</figcaption>` : ""}
  <div id="${id}" class="lightbox" popover>
    <button type="button" class="lightbox__close" popovertarget="${id}" popovertargetaction="hide">Close</button>
${indent(picture(src, w, h, s.alt), 4)}
    <a class="lightbox__full" href="${src}" target="_blank" rel="noopener noreferrer">Open full size${hidden(" (opens in a new tab)")}</a>
  </div>
</figure>`;
}

function project(p, i) {
  const id = `project-${p.id}`;
  return `<article id="${id}" class="project card${i % 2 ? " project--flip" : ""}" aria-labelledby="${id}-title">
  <div class="project__text">
    <h3 id="${id}-title">${esc(p.name)}</h3>
    <dl>
      <dt>The problem</dt>
      <dd>${esc(p.problem)}</dd>
      <dt>What I built</dt>
      <dd>${esc(p.built)}</dd>
    </dl>
    <ul class="chips" aria-label="Tech stack">
${p.stack.map((s) => `      <li>${esc(s)}</li>`).join("\n")}
    </ul>
    <ul class="project__links" aria-label="Links for ${esc(p.name)}">
${p.links.map((l) => `      <li><a class="button button--sm" href="${esc(href(l.href))}">${esc(l.label)}${hidden(` for ${p.name}`)}</a></li>`).join("\n")}
    </ul>${p.credit ? `
    <p class="credit">${esc(p.credit)}</p>` : ""}
  </div>${p.screenshots.length ? `
  <div class="project__shots" data-count="${p.screenshots.length}">
${indent(p.screenshots.map((sh, i) => figure(sh, `shot-${p.id}-${i + 1}`)).join("\n"), 4)}
  </div>` : ""}
</article>`;
}

// Between projects 1 and 2: the ground line with the curled-up cat asleep on it.
const dividerCat = () => `<div class="divider divider--cat" aria-hidden="true">
  ${ground()}
${indent(grounded("cat-curled", { left: "10%", width: "clamp(110px, 16vw, 170px)", cls: "divider__cat", inline: true }), 2)}
</div>`;
// Between projects 2 and 3: the double-stroke line with a few small doodles. No animal.
const dividerLine = () => `<div class="divider divider--line" aria-hidden="true">
  ${ground("underline-double")}
  <div class="decor">
${indent([deco("scribble", { x: 22, y: 0, w: 40, r: -8 }), deco("sunburst", { x: 50, y: -6, w: 50 }), deco("dots-dashes", { x: 72, y: 12, w: 84 })].join("\n"), 4)}
  </div>
</div>`;

const work = () => {
  const parts = [];
  c.projects.forEach((p, i) => {
    parts.push(project(p, i));
    if (i === 0 && c.projects.length > 1) parts.push(dividerCat());
    if (i === 1 && c.projects.length > 2) parts.push(dividerLine());
  });
  return `<section id="work" class="section" aria-labelledby="work-title">
${indent([
    gutter("l", "6rem", [["blob-coral", 18, 30, 90], ["wave", 26, 56, 70, -6], ["asterisk", 58, 170, 34]]),
    gutter("r", "38%", [["blob-sky-2", 10, 20, 100], ["satellite", 20, 40, 70, 12], ["spiral", 50, 190, 44]]),
    gutter("l", "70%", [["x-mark", 40, 0, 36, -12], ["leaf", 20, 120, 46, 10]]),
  ].join("\n"), 2)}
  <div class="wrap">
${indent(sectionHead("work", c.sections.work), 4)}
${indent(parts.join("\n"), 4)}
  </div>
</section>`;
};

const howIWork = () => `<section id="how-i-work" class="section" aria-labelledby="how-i-work-title">
${indent([gutter("l", "3rem", [["moon", 50, 20, 50, -8], ["arrow", 24, 150, 60, 14]]), gutter("r", "4rem", [["flower", 30, 10, 46, 10], ["squiggle", 20, 110, 80, -6]], true)].join("\n"), 2)}
  <div class="wrap">
${indent(sectionHead("how-i-work", c.howIWork.heading), 4)}
    <ol class="points">
${c.howIWork.points.map((p, i) => `      <li class="card point">
        <span class="point__n" aria-hidden="true">0${i + 1}</span>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.text)}</p>
      </li>`).join("\n")}
    </ol>
  </div>
</section>`;

const skills = () => `<section id="skills" class="section" aria-labelledby="skills-title">
${indent([gutter("l", "9rem", [["triangle", 44, 0, 44, -10], ["bolt", 22, 140, 40, 12]]), gutter("r", "5rem", [["blob-mustard-2", 14, 40, 96], ["pencil", 20, 64, 84, -14], ["raindrop", 56, 170, 36, -8]])].join("\n"), 2)}
  <div class="wrap">
${indent(sectionHead("skills", c.sections.skills), 4)}
    <div class="skills-layout">
      ${figureArt("mascot-magnifier", "skills-layout__art")}
      <div class="skill-grid">
${c.skills.map((g) => `        <div class="card skill-card">
          <h3 id="skills-${slug(g.group)}">${esc(g.group)}</h3>
          <ul class="chips" aria-labelledby="skills-${slug(g.group)}">
${g.items.map((i) => `            <li>${esc(i)}</li>`).join("\n")}
          </ul>
        </div>`).join("\n")}
      </div>
    </div>
  </div>
</section>`;

const experience = () => `<section id="experience" class="section" aria-labelledby="experience-title">
${indent([gutter("l", "5rem", [["blob-green", 20, 30, 90], ["rainbow", 24, 40, 84, -6], ["dot-trio", 30, 170, 64]], true), gutter("r", "3rem", [["check", 36, 10, 44, -6], ["zigzag", 18, 130, 70, 8]])].join("\n"), 2)}
  <div class="wrap">
${indent(sectionHead("experience", c.sections.experience), 4)}
    <div class="experience-layout">
      <ol class="timeline">
${c.experience.map((e) => `        <li class="timeline__item">
          <p class="timeline__dates">${time(e.start)} - ${time(e.end)}</p>
          <div class="timeline__body">
            <h3>${esc(e.role)}<span class="timeline__org">${esc(e.org)}</span></h3>
            <ul>
${e.points.map((p) => `              <li>${esc(p)}</li>`).join("\n")}
            </ul>
          </div>
        </li>`).join("\n")}
      </ol>
      ${figureArt("mascot-climbing", "experience-layout__art")}
    </div>
  </div>
</section>`;

const recognition = () => `<section id="recognition" class="section" aria-labelledby="recognition-title">
${indent([gutter("l", "6rem", [["planet", 30, 10, 60, -10], ["emphasis", 52, 150, 44, -8]]), gutter("r", "8rem", [["diamond", 30, 0, 40, 10], ["plus", 54, 110, 42, -12]])].join("\n"), 2)}
  <div class="wrap">
${indent(sectionHead("recognition", c.sections.recognition, figureArt("mascot-celebrating", "section-head__art")), 4)}
    <ul class="recog-grid">
${c.recognition.map((r) => `      <li class="card recog-card">
        <a href="${esc(r.href)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}${hidden(" (certificate, opens in a new tab)")}</a>
        <p>${esc(r.detail)}</p>
      </li>`).join("\n")}
      <li class="recog-grid__cat" aria-hidden="true">
        ${ground()}
${indent(grounded("cat-stretching", { left: "50%", width: "clamp(150px, 46%, 230px)", cls: "recog-cat" }), 8)}
      </li>
    </ul>
  </div>
</section>`;

const about = () => `<section id="about" class="section" aria-labelledby="about-title">
${indent([gutter("l", "6rem", [["blob-coral", 10, 40, 90], ["lightbulb", 28, 46, 52, -10], ["scribble", 46, 170, 50]], true), gutter("r", "10rem", [["loops", 16, 20, 96, -4]])].join("\n"), 2)}
  <div class="wrap">
${indent(sectionHead("about", c.about.heading), 4)}
    <div class="about-layout">
      <ul class="trait-grid">
${c.about.traits.map((t) => {
    const f = t.doodle.split("/").pop().replace(".svg", "");
    const { w, h } = svgSize(DOODLE(f));
    return `        <li class="card trait">
          <img class="trait__art" src="${DOODLE(f)}" width="${w}" height="${h}" loading="lazy" decoding="async" alt="" aria-hidden="true">
          <div>
            <h3>${esc(t.name)}</h3>
            <p>${esc(t.text)}</p>
          </div>
        </li>`;
  }).join("\n")}
      </ul>
      ${figureArt("mascot-thinking", "about-layout__art")}
    </div>
  </div>
</section>`;

const contact = () => {
  const buttons = c.contact.links.filter((l) => !l.href.endsWith(".pdf"));
  const resume = c.contact.links.find((l) => l.href.endsWith(".pdf"));
  return `<section id="contact" class="section section--contact" aria-labelledby="contact-title">
${indent(gutter("r", "6rem", [["blob-sky-2", 20, 10, 96], ["ring", 34, 34, 44], ["x-mark", 60, 150, 32, 8], ["wave", 20, 230, 70, -4]]), 2)}
  <div class="wrap">
${indent(sectionHead("contact", c.contact.heading), 4)}
    <ul class="contact-links">
${buttons.map((l) => {
    const isMail = l.href.startsWith("mailto:");
    return `      <li><a class="button" href="${esc(href(l.href))}">${esc(isMail ? c.contact.email : l.label)}${isMail ? hidden(" (email)") : ""}</a></li>`;
  }).join("\n")}
    </ul>${resume ? `
    <p class="contact-resume"><a href="${esc(href(resume.href))}">${esc(resume.label)}${hidden(" (PDF)")}</a></p>` : ""}
    <div class="contact-scene" aria-hidden="true">
      ${ground()}
${indent(grounded("mascot-waving", { left: "26%", width: "clamp(120px, 22vw, 190px)" }), 6)}
${indent(grounded("cat-sitting", { left: "62%", width: "clamp(70px, 11vw, 100px)" }), 6)}
    </div>
  </div>
</section>`;
};

const footer = () => `<footer class="site-footer">
  <div class="footer-scene" aria-hidden="true">
    ${ground()}
${indent(grounded("mascot-peeking", { left: "12%", width: "clamp(130px, 16vw, 190px)", cls: "footer-peek" }), 4)}
${indent(grounded("cat-walking", { left: "64%", width: "clamp(100px, 13vw, 150px)", cls: "footer-cat" }), 4)}
  </div>
  <p>${esc(c.footer.text)}</p>
</footer>`;

/* ---------- page ---------- */
const m = c.meta;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="canonical" href="${esc(m.url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(m.name)}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(m.url)}">
<meta property="og:image" content="${esc(m.url)}assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(m.og.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.title)}">
<meta name="twitter:description" content="${esc(m.description)}">
<meta name="twitter:image" content="${esc(m.url)}assets/og.png">
<meta name="theme-color" content="#F1EEE6">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Person",
  name: m.name,
  url: m.url,
  jobTitle: m.jobTitle,
  sameAs: c.contact.links.filter((l) => /^https?:/.test(l.href)).map((l) => l.href),
})}</script>
<link rel="preload" href="assets/fonts/fraunces-latin-soft-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/instrument-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/tokens.css">
<link rel="stylesheet" href="assets/css/base.css">
<link rel="stylesheet" href="assets/css/header.css">
<link rel="stylesheet" href="assets/css/hero.css">
<link rel="stylesheet" href="assets/css/sections.css">
<link rel="stylesheet" href="assets/css/decor.css">
<script src="assets/js/site.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${header()}
<main id="main" tabindex="-1">
${[hero, work, howIWork, skills, experience, recognition, about, contact].map((f) => indent(f(), 2)).join("\n\n")}
</main>
${footer()}
</body>
</html>
`;

if (/\u2014/.test(html)) throw new Error("em dash found in output");

// Usage checks. Every mascot and cat pose at most once; small doodles and blobs at most twice.
const uses = {};
for (const m of html.matchAll(/assets\/doodles\/([a-z0-9-]+)\.svg|data-asset="([a-z0-9-]+)"/g)) {
  const f = m[1] || m[2];
  uses[f] = (uses[f] || 0) + 1;
}
const errors = [];
for (const [f, n] of Object.entries(uses)) {
  if (/^(mascot|cat)-/.test(f) && n > 1) errors.push(`${f} is used ${n} times (max 1)`);
  else if (!/^(mascot|cat|ground-line|underline|trait)-?/.test(f) && n > 2) errors.push(`${f} is used ${n} times (max 2)`);
}
if (errors.length) { console.error("Doodle usage check failed:\n  " + errors.join("\n  ")); process.exit(1); }
fs.writeFileSync(path.join(ROOT, "index.html"), html);

/* ---------- 404 (GitHub Pages serves it for any missing path, so paths are root-relative) ---------- */
const nf = c.notFound;
const { w: nfw, h: nfh } = svgSize(DOODLE("mascot-standing"));
const { w: gw, h: gh } = svgSize(DOODLE("ground-line"));
const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(nf.title)} | ${esc(m.name)}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/base.css">
<style>
  .nf { min-height: 100vh; display: grid; place-items: center; padding: var(--space-6) var(--gutter); text-align: center; }
  .nf__art { position: relative; width: min(260px, 70vw); margin: 0 auto var(--space-5); }
  .nf__art .mascot { width: 100%; height: auto; }
  .nf__art .ground-line { width: 160%; max-width: 90vw; height: 16px; margin: -12px 0 0 -30%; }
  .nf h1 { margin-bottom: var(--space-3); }
  .nf p { margin: 0 0 var(--space-6); }
</style>
</head>
<body>
<main class="nf">
  <div>
    <div class="nf__art" aria-hidden="true">
      <img class="mascot" src="/assets/doodles/mascot-standing.svg" width="${nfw}" height="${nfh}" alt="">
      <img class="ground-line" src="/assets/doodles/ground-line.svg" width="${gw}" height="${gh}" alt="">
    </div>
    <h1>${esc(nf.heading)}</h1>
    <p>${esc(nf.text)}</p>
    <a class="button" href="/">${esc(nf.link)}</a>
  </div>
</main>
</body>
</html>
`;
if (/\u2014/.test(notFound)) throw new Error("em dash found in 404");
fs.writeFileSync(path.join(ROOT, "404.html"), notFound);

/* ---------- ship only the doodles the site references ---------- */
const cssText = fs.readdirSync(path.join(ROOT, "assets/css")).map((f) => fs.readFileSync(path.join(ROOT, "assets/css", f), "utf8")).join("\n");
const used = new Set();
for (const text of [html, notFound, cssText]) {
  for (const mm of text.matchAll(/doodles\/([a-z0-9-]+)\.svg/g)) used.add(mm[1]);
}
const outDir = path.join(ROOT, "assets/doodles");
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith(".svg") && !used.has(f.slice(0, -4))) fs.unlinkSync(path.join(outDir, f));
}
for (const name of [...used].sort()) {
  const target = path.join(outDir, `${name}.svg`), data = libSvg(name);
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== data) fs.writeFileSync(target, data);
}
// favicon.svg: the mascot face, minified like the other doodles
fs.writeFileSync(path.join(ROOT, "assets/favicon.svg"), libSvg("mascot-face"));
console.log(`wrote index.html (${html.length} bytes), 404.html, ${used.size} doodles in assets/doodles`);
