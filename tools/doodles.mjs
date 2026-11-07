// Doodle kit generator. Authoring tool only: the site never runs this.
// Usage: node tools/doodles.mjs   -> writes assets/doodles/*.svg and kit.html
//
// Every asset starts as clean geometry (ellipses, polylines, smooth curves) and is
// pushed off-true by seeded, low-frequency noise, so the whole kit shares one hand.
// Outlines are ink strokes (3px, non-scaling, round caps/joins). Colour sits in
// separate blobs drawn underneath and nudged off the outline, like a misregistered print.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Full library + kit.html go to design/ (gitignored). tools/build.mjs copies only the
// SVGs the site references into assets/doodles, so unused drawings never ship.
const DESIGN = path.join(ROOT, "design");
const OUT = path.join(DESIGN, "doodles");
fs.mkdirSync(OUT, { recursive: true });

const C = {
  cream: "#F1EEE6", ink: "#141414", mustard: "#E8C547", coral: "#EE5A3F",
  blue: "#5B73B0", green: "#2F6B52", sky: "#9CC7EE",
};
const WHITE = "#FFFCF4";
const TAU = Math.PI * 2;

/* ---------- seeded randomness ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- geometry helpers ---------- */
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const rot = ([x, y], a, [cx, cy] = [0, 0]) => {
  const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
const mirror = (pts, axis = 500) => pts.map(([x, y]) => [2 * axis - x, y]);
const move = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
const centroid = (pts) => {
  const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [s[0] / pts.length, s[1] / pts.length];
};
const scaleAbout = (pts, k, c = centroid(pts)) => pts.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);
const pathLength = (pts, closed) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed) L += dist(pts[pts.length - 1], pts[0]);
  return L;
};

// Dense polyline through control points (Catmull-Rom).
function catmull(pts, closed, step = 8) {
  const n = pts.length, out = [];
  const get = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const per = Math.max(3, Math.ceil(dist(p1, p2) / step));
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

// Evenly spaced points along a polyline.
function resample(pts, step, closed) {
  const src = closed ? [...pts, pts[0]] : pts;
  const out = [src[0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i], d = dist(a, b);
    let t = step - carry;
    while (t <= d) { out.push(lerp(a, b, t / d)); t += step; }
    carry = d - (t - step);
  }
  if (closed) {
    if (dist(out[out.length - 1], out[0]) < step * 0.5) out.pop();
  } else if (dist(out[out.length - 1], src[src.length - 1]) > step * 0.25) {
    out.push(src[src.length - 1]);
  } else {
    out[out.length - 1] = src[src.length - 1];
  }
  return out;
}

// Smooth 1D value noise in [-1, 1]; periodic when closed so loops still close.
function makeNoise(rand, L, wl, closed) {
  const count = closed ? Math.max(3, Math.round(L / wl)) : Math.ceil(L / wl) + 2;
  const spacing = closed ? L / count : wl;
  const knots = Array.from({ length: count }, () => rand() * 2 - 1);
  return (s) => {
    const x = s / spacing, i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const a = knots[((i % count) + count) % count], b = knots[(((i + 1) % count) + count) % count];
    return a + (b - a) * u;
  };
}

function wobble(pts, { amp, wl, closed, rand, step }) {
  const L = pathLength(pts, closed);
  const dense = resample(pts, step ?? Math.max(1.5, Math.min(wl / 6, L / 10)), closed);
  const n1 = makeNoise(rand, L, wl, closed), n2 = makeNoise(rand, L, wl / 3.3, closed);
  const n = dense.length;
  let s = 0;
  return dense.map((p, i) => {
    if (i > 0) s += dist(dense[i - 1], p);
    const prev = dense[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = dense[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = next[0] - prev[0], ty = next[1] - prev[1], tl = Math.hypot(tx, ty) || 1;
    const off = amp * (n1(s) + 0.35 * n2(s)) + (rand() - 0.5) * amp * 0.12;
    return [p[0] - (ty / tl) * off, p[1] + (tx / tl) * off];
  });
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();
function toPath(p, closed) {
  const n = p.length;
  if (n < 2) return "";
  const get = (i) => (closed ? p[((i % n) + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + (closed ? "Z" : "");
}

/* ---------- shape point generators ---------- */
function ellipsePts(cx, cy, rx, ry, { rot: r = 0, start = 0, sweep = TAU, overshoot = 0, drift = 0 } = {}) {
  const total = sweep + overshoot, N = Math.max(16, Math.round(96 * total / TAU));
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = start + (total * i) / N, f = 1 + drift * (i / N);
    pts.push(rot([cx + rx * f * Math.cos(t), cy + ry * f * Math.sin(t)], r, [cx, cy]));
  }
  if (sweep >= TAU && overshoot === 0) pts.pop();
  return pts;
}
function rrectPts(x, y, w, h, r) {
  const pts = [], k = 8;
  const corner = (cx, cy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (Math.PI / 2) * (i / k); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}
function quadPts(a, c, b, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}
function arcPts(cx, cy, r, a0, a1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
const deg = (d) => (d * Math.PI) / 180;

/* ---------- the drawing surface ---------- */
class Doodle {
  constructor(name, w, h, k = 1) {
    this.name = name; this.w = w; this.h = h; this.k = k;
    this.rand = mulberry32(hash(name));
    this.parts = [];
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
    // One misregistration direction per print, roughly down and to the right.
    const a = deg(22 + this.rand() * 30), m = 30 * k * (0.85 + this.rand() * 0.3);
    this.off = [Math.cos(a) * m, Math.sin(a) * m];
    this.amp = 4.5 * k; this.wl = 150 * k;
    this.stretch = false; // true: preserveAspectRatio="none", for lines used as stretchable backgrounds
  }
  r(a, b) { return a + (b - a) * this.rand(); }
  grow(pts) {
    for (const [x, y] of pts) {
      this.box = [Math.min(this.box[0], x), Math.min(this.box[1], y), Math.max(this.box[2], x), Math.max(this.box[3], y)];
    }
    return pts;
  }

  // Ink outline. smooth: run Catmull-Rom through the control points first.
  // loop: a closed shape drawn as one stroke whose end overshoots its start.
  stroke(pts, { smooth = false, loop = false, amp = this.amp, wl = this.wl, width = 3, step } = {}) {
    let p = smooth ? catmull(pts, loop, 6 * this.k + 2) : pts;
    if (loop) {
      p = resample(p, Math.max(1.5, wl / 8), true);
      const s = Math.floor(this.rand() * p.length);
      p = [...p.slice(s), ...p.slice(0, s)];
      const extra = Math.max(2, Math.round(p.length * this.r(0.04, 0.09)));
      p = [...p, ...p.slice(0, extra)];
    }
    const w = this.grow(wobble(p, { amp, wl, closed: false, rand: this.rand, step }));
    this.parts.push(`<path d="${toPath(w, false)}" fill="none" stroke="${C.ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
    return this;
  }
  curve(pts, o = {}) { return this.stroke(pts, { ...o, smooth: true }); }
  ellipse(cx, cy, rx, ry, o = {}) {
    const p = ellipsePts(cx, cy, rx, ry, {
      rot: o.rot ?? 0, start: this.r(0, TAU), overshoot: this.r(0.12, 0.32), drift: this.r(-0.035, 0.035),
    });
    return this.stroke(p, { amp: o.amp ?? Math.min(this.amp, 0.035 * Math.max(rx, ry)), wl: o.wl ?? Math.min(this.wl, Math.max(rx, ry) * 1.1), step: o.step });
  }

  // Colour blob beneath an outline, nudged off-register.
  blob(pts, color, { smooth = true, amp = this.amp * 2.2, wl = this.wl * 1.5, shrink = 0.97, offset = 1, opacity } = {}) {
    let p = smooth ? catmull(pts, true, 6 * this.k + 2) : pts;
    p = scaleAbout(p, shrink);
    const j = this.r(0.85, 1.15) * offset;
    p = move(p, this.off[0] * j, this.off[1] * j);
    const w = this.grow(wobble(p, { amp, wl, closed: true, rand: this.rand }));
    this.parts.push(`<path d="${toPath(w, true)}" fill="${color}"${opacity ? ` fill-opacity="${opacity}"` : ""}/>`);
    return this;
  }
  ellipseBlob(cx, cy, rx, ry, color, o = {}) {
    return this.blob(ellipsePts(cx, cy, rx, ry, { rot: o.rot ?? 0 }), color, { smooth: false, ...o });
  }

  // Solid shape, on register (eye whites, pupils, glasses, mouth).
  solid(pts, color, { smooth = false, amp = this.amp * 0.5, wl = this.wl, holes = [] } = {}) {
    const ring = (q) => toPath(this.grow(wobble(smooth ? catmull(q, true, 6 * this.k + 2) : q, { amp, wl, closed: true, rand: this.rand })), true);
    const d = [ring(pts), ...holes.map(ring)].join("");
    this.parts.push(`<path d="${d}" fill="${color}"${holes.length ? ' fill-rule="evenodd"' : ""}/>`);
    return this;
  }
  dot(cx, cy, r, color = C.ink) {
    return this.solid(ellipsePts(cx, cy, r * this.r(0.9, 1.1), r * this.r(0.9, 1.1), { rot: this.r(0, 3) }), color, { amp: r * 0.08, wl: r * 2 });
  }

  // Crop the viewBox to the drawing plus a small margin for the stroke.
  crop() {
    const pad = Math.max(4, 0.025 * Math.max(this.box[2] - this.box[0], this.box[3] - this.box[1]));
    const x = Math.floor(this.box[0] - pad), y = Math.floor(this.box[1] - pad);
    this.vb = [x, y, Math.ceil(this.box[2] + pad) - x, Math.ceil(this.box[3] + pad) - y];
    this.w = this.vb[2]; this.h = this.vb[3];
  }
  svg(title) {
    if (!this.vb) this.crop();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${this.vb.join(" ")}" width="${this.w}" height="${this.h}"${this.stretch ? ' preserveAspectRatio="none"' : ""} role="img" aria-label="${title}">\n` +
      this.parts.map((p) => "  " + p).join("\n") + "\n</svg>\n";
  }
}

/* ---------- registry ---------- */
const KIT = []; // {group, file, label, w, h, display}
function save(group, file, label, d, display) {
  const svg = d.svg(label);
  fs.writeFileSync(path.join(OUT, file), svg);
  KIT.push({ group, file, label, w: d.w, h: d.h, display });
}

/* =====================================================================
   MASCOT
   Round yellow head, big white oval eyes with black pupils and one
   highlight each, thick black rectangular glasses, small flat mouth,
   stubby body with tiny arms and legs.
   ===================================================================== */
const HEAD = { cx: 500, cy: 380, rx: 262, ry: 250 };
const BODY_STAND = [[410, 612], [396, 670], [386, 740], [386, 800], [392, 850], [404, 878], [440, 887], [468, 876],
  [474, 845], [500, 830], [526, 845], [532, 876], [560, 887], [596, 878], [608, 850], [614, 800], [614, 740], [604, 670], [590, 612]];
const ARM_DOWN_L = [[393, 666], [362, 690], [338, 734], [345, 768], [372, 771], [391, 746]];
const ARM_DOWN_R = mirror(ARM_DOWN_L);
// About as wide as the old flat mouth (136), ends lifted a little, right end a touch higher.
const SMILE = [[441, 562], [462, 574], [500, 581], [538, 575], [557, 566], [561, 560]];

function mascot(name, label, pose) {
  const W = pose.w ?? 1000, H = pose.h ?? 1000;
  const d = new Doodle(name, W, H, 1);
  const body = pose.body ?? BODY_STAND;
  const armL = pose.armL ?? ARM_DOWN_L, armR = pose.armR ?? ARM_DOWN_R;
  const [px, py] = pose.look ?? [0, 0];

  pose.behind?.(d);

  if (pose.headOnly) {
    d.ellipseBlob(HEAD.cx, HEAD.cy, HEAD.rx * 0.99, HEAD.ry * 0.99, C.mustard, { offset: 0.5 });
    d.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, { amp: 5, wl: 170 });
  } else if (pose.peek) {
    // Peeking: only the part of the head above the wall line at y = pose.peek.
    const t = Math.asin((pose.peek - HEAD.cy) / HEAD.ry);
    const arc = ellipsePts(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, { start: Math.PI - t, sweep: Math.PI + 2 * t, overshoot: 0 });
    d.blob(arc, C.mustard, { smooth: false });
    pose.colour?.(d);
    d.stroke(arc, { amp: 5, wl: 170 });
  } else {
    // colour, under everything
    d.blob([...body, [500, 560]], C.mustard, { offset: 0.8 });
    d.blob(armL, C.mustard, { offset: 0.5, amp: 3 });
    d.blob(armR, C.mustard, { offset: 0.5, amp: 3 });
    d.ellipseBlob(HEAD.cx, HEAD.cy, HEAD.rx * 0.99, HEAD.ry * 0.99, C.mustard);
    pose.colour?.(d);

    // body + arms + head outlines
    d.curve(body);
    d.curve(armL, { amp: 2.5, wl: 80 });
    d.curve(armR, { amp: 2.5, wl: 80 });
    d.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, { amp: 5, wl: 170 });
  }

  // eyes
  for (const s of [-1, 1]) {
    const ex = 500 + s * 108, ey = 425;
    d.solid(ellipsePts(ex, ey, 82, 102), WHITE, { amp: 2, wl: 90 });
    d.ellipse(ex, ey, 82, 102, { amp: 2.5, wl: 100 });
    const qx = ex - s * 16 + px, qy = ey + 13 + py;
    d.parts.push('<g class="pupil">');
    d.solid(ellipsePts(qx, qy, 37, 51, { rot: s * 0.06 }), C.ink, { amp: 1.4, wl: 60 });
    d.solid(ellipsePts(qx - 14, qy - 25, 10, 10.5), WHITE, { amp: 0.6, wl: 20 });
    d.parts.push("</g>");
  }

  // glasses: thick ink frames, a bridge and two short temple stubs
  for (const s of [-1, 1]) {
    const ox = s < 0 ? 266 : 512;
    const outer = rrectPts(ox, 340, 222, 158, 30);
    const inner = rrectPts(ox + 15, 360, 192, 125, 18);
    d.solid(outer, C.ink, { amp: 1.6, wl: 120, holes: [inner] });
  }
  d.solid([[482, 357], [500, 352], [518, 357], [518, 380], [500, 375], [482, 380]], C.ink, { amp: 0.8, wl: 40 });
  d.solid(rrectPts(234, 352, 38, 16, 7), C.ink, { amp: 0.6, wl: 30 });
  d.solid(rrectPts(728, 352, 38, 16, 7), C.ink, { amp: 0.6, wl: 30 });

  // mouth: a small, gentle smile in the same pen.
  // The old flat mouth is still computed and discarded so the main seeded stream
  // advances exactly as before and nothing drawn after it shifts. The smile gets
  // its own seed.
  d.solid(rrectPts(432, 562, 136, 22, 11), C.ink, { amp: 1.3, wl: 60 });
  d.parts.pop();
  const mainRand = d.rand;
  d.rand = mulberry32(hash(`${name}:smile`));
  d.curve(SMILE, { amp: 1.1, wl: 70, step: 6 });
  d.rand = mainRand;

  pose.front?.(d);
  save(pose.group ?? "Mascot", `${name}.svg`, label, d, 0.3);
}

mascot("mascot-standing", "Mascot, standing", {});

mascot("mascot-waving", "Mascot, waving", {
  look: [6, -4],
  armR: [[606, 662], [642, 640], [680, 592], [700, 552], [722, 542], [737, 560], [718, 610], [670, 676], [612, 702]],
  front(d) {
    d.curve([[762, 500], [786, 530], [792, 572]], { amp: 2, wl: 60 });
    d.curve([[790, 462], [826, 510], [834, 572]], { amp: 2, wl: 60 });
    d.curve([[688, 500], [700, 470], [722, 458]], { amp: 1.5, wl: 50 });
  },
});

{
  // satellite dish, held up on a short pole
  const A = deg(30), O = [858, 440], RX = 115;
  const L = (p) => rot([p[0] + O[0], p[1] + O[1]], A, O);
  const bowl = ellipsePts(0, 0, RX, 88, { start: 0, sweep: Math.PI }).map(L);
  const dishShape = [...ellipsePts(0, 0, RX, 32, { start: Math.PI, sweep: Math.PI }), ...ellipsePts(0, 0, RX, 88, { start: 0, sweep: Math.PI })].map(L);
  const tip = L([0, -112]), foot = L([0, 88]);
  mascot("mascot-dish", "Mascot, holding a satellite dish", {
    look: [18, -16],
    armR: [[607, 670], [648, 690], [688, 700], [708, 720], [694, 742], [652, 738], [611, 726]],
    colour(d) { d.blob(dishShape, C.sky, { smooth: false, amp: 4, offset: 0.7 }); },
    front(d) {
      d.curve([[702, 724], lerp([702, 724], foot, 0.5), foot], { amp: 2, wl: 80 });
      d.stroke(bowl, { amp: 3, wl: 110 });
      d.ellipse(...O, RX, 32, { rot: A, amp: 2.5 });
      d.curve([L([0, 0]), L([-5, -56]), tip], { amp: 1.5, wl: 60 });
      d.dot(tip[0], tip[1], 11);
      for (const [r, a0, a1] of [[36, -100, -12], [64, -104, -8], [92, -98, -16]]) {
        d.curve(arcPts(tip[0], tip[1], r, deg(a0), deg(a1), 8), { amp: 1.8, wl: 50 });
      }
    },
  });
}

{
  // magnifying glass, lens in front of the right cheek
  const lc = [732, 560], lr = 82;
  const a = deg(58), e1 = [lc[0] + lr * Math.cos(a), lc[1] + lr * Math.sin(a)];
  const dir = [Math.cos(a), Math.sin(a)], nrm = [-dir[1], dir[0]];
  const hp = (t, w) => [e1[0] + dir[0] * t + nrm[0] * w, e1[1] + dir[1] * t + nrm[1] * w];
  const handle = [hp(-4, -13), hp(96, -13), hp(104, 0), hp(96, 13), hp(-4, 13)];
  mascot("mascot-magnifier", "Mascot, looking through a magnifying glass", {
    look: [22, 16],
    armR: [[607, 668], [660, 692], [722, 702], [772, 694], [796, 712], [784, 736], [736, 738], [612, 726]],
    colour(d) { d.ellipseBlob(lc[0], lc[1], lr, lr, C.sky, { opacity: 0.6, offset: 0.6, amp: 4 }); },
    front(d) {
      d.solid(handle, C.ink, { amp: 1, wl: 40 });
      d.ellipse(lc[0], lc[1], lr, lr, { amp: 2.4 });
      d.ellipse(lc[0], lc[1], lr - 12, lr - 12, { amp: 2 });
      d.curve(arcPts(lc[0], lc[1], lr - 32, deg(200), deg(250), 6), { amp: 1.2, wl: 40 });
    },
  });
}

{
  // climbing: left foot on the first tread, right foot up on the second
  const steps = [[60, 887], [566, 887], [566, 816], [790, 816], [790, 745], [960, 745], [960, 674], [1080, 674]];
  const block = [...steps, [1080, 942], [60, 942]];
  mascot("mascot-climbing", "Mascot, climbing steps", {
    w: 1120,
    look: [14, -16],
    body: [[410, 612], [396, 670], [386, 740], [386, 800], [392, 850], [404, 879], [440, 888], [468, 877], [474, 846],
      [500, 826], [540, 822], [584, 806], [604, 812], [626, 817], [664, 814], [672, 792], [654, 762], [616, 732], [606, 680], [590, 612]],
    armL: [[393, 668], [358, 700], [330, 744], [338, 772], [366, 764], [390, 736]],
    armR: [[605, 662], [644, 646], [684, 620], [706, 632], [696, 658], [652, 688], [609, 700]],
    behind(d) {
      d.blob(block, C.blue, { smooth: false, amp: 6, offset: 0.8 });
      d.stroke(steps, { amp: 2.5, wl: 160, step: 10 });
      d.stroke([[1080, 674], [1080, 942], [60, 942], [60, 887]], { amp: 2.5, wl: 160, step: 10 });
    },
  });
}

/* ---------- more poses ---------- */
mascot("mascot-celebrating", "Mascot, celebrating", {
  look: [0, -16],
  armL: mirror([[606, 662], [648, 640], [690, 600], [722, 556], [740, 520], [758, 522], [764, 548], [744, 596], [702, 652], [612, 702]]),
  armR: [[606, 662], [648, 640], [690, 600], [722, 556], [740, 520], [758, 522], [764, 548], [744, 596], [702, 652], [612, 702]],
  front(d) {
    // little bursts of joy around the raised hands
    for (const [x0, y0, x1, y1] of [[792, 488, 826, 462], [800, 528, 842, 524], [770, 456, 784, 418],
      [208, 488, 174, 462], [200, 528, 158, 524], [230, 456, 216, 418]]) {
      d.stroke([[x0, y0], [x1, y1]], { amp: 1.2, wl: 40 });
    }
    d.dot(850, 420, 9, C.coral);
    d.dot(150, 420, 9, C.sky);
    d.dot(500, 92, 8, C.mustard);
  },
});

mascot("mascot-thinking", "Mascot, thinking", {
  look: [-14, -22],
  armR: [[607, 668], [646, 690], [664, 664], [654, 634], [626, 620]],
  front(d) {
    // fist resting on the chin, drawn over the head line
    d.solid(ellipsePts(606, 626, 30, 25, { rot: -0.3 }), C.mustard, { amp: 1.2, wl: 50 });
    d.ellipse(606, 626, 30, 25, { rot: -0.3, amp: 1.4 });
    d.curve([[590, 618], [596, 630], [592, 642]], { amp: 0.6, wl: 20 });
    // thought bubbles
    d.ellipse(772, 236, 15, 13, { amp: 1 });
    d.ellipse(816, 178, 24, 21, { amp: 1.2 });
    d.ellipseBlob(894, 98, 62, 44, C.sky, { offset: 0.5 });
    d.ellipse(894, 98, 62, 44, { amp: 2 });
    for (const x of [868, 894, 920]) d.dot(x, 100, 6);
  },
});

mascot("mascot-peeking", "Mascot, peeking over a line", {
  peek: 612,
  look: [0, 10],
  front(d) {
    for (const s of [-1, 1]) {
      const hx = 500 + s * 170;
      const hand = [[hx - 42, 614], [hx - 40, 588], [hx - 22, 572], [hx + 2, 568], [hx + 26, 574], [hx + 42, 592], [hx + 42, 614]];
      d.solid(hand, C.mustard, { smooth: true, amp: 1.5, wl: 60 });
      d.curve(hand, { amp: 1.5, wl: 60 });
      d.stroke([[hx - 12, 584], [hx - 12, 610]], { amp: 0.6, wl: 20 });
      d.stroke([[hx + 12, 584], [hx + 12, 610]], { amp: 0.6, wl: 20 });
    }
    d.curve([[110, 614], [300, 612], [500, 616], [700, 612], [890, 614]], { amp: 2, wl: 150 });
  },
});

mascot("mascot-face", "Mascot face (favicon source)", { headOnly: true, group: "Icons" });

/* =====================================================================
   CAT (original): a round-headed cat with short pointed ears
   ===================================================================== */
function catHead(d, cx, cy, rx, ry, { sleepy = false, faceX = 0 } = {}) {
  d.ellipse(cx, cy, rx, ry, { amp: 2.5 });
  const ex = cx + faceX;
  if (sleepy) {
    d.curve([[ex - 38, cy + 4], [ex - 27, cy + 14], [ex - 16, cy + 4]], { amp: 0.8, wl: 30 });
    d.curve([[ex + 14, cy + 2], [ex + 25, cy + 12], [ex + 36, cy + 2]], { amp: 0.8, wl: 30 });
  } else {
    d.dot(ex - 27, cy - 2, 7.5);
    d.dot(ex + 27, cy - 4, 7.5);
  }
  d.solid([[ex - 7, cy + 18], [ex + 7, cy + 17], [ex, cy + 26]], C.ink, { amp: 0.5, wl: 10 });
  d.curve([[ex - 14, cy + 32], [ex - 7, cy + 38], [ex, cy + 30], [ex + 7, cy + 38], [ex + 14, cy + 32]], { amp: 0.6, wl: 20 });
  d.stroke([[ex + 44, cy + 22], [ex + 92, cy + 14]], { amp: 1.2, wl: 40 });
  d.stroke([[ex + 45, cy + 32], [ex + 94, cy + 37]], { amp: 1.2, wl: 40 });
  d.stroke([[ex - 44, cy + 22], [ex - 92, cy + 14]], { amp: 1.2, wl: 40 });
  d.stroke([[ex - 45, cy + 32], [ex - 94, cy + 37]], { amp: 1.2, wl: 40 });
}
function catEars(d, cx, cy, rx, ry, tilt = 0) {
  const top = (a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  for (const [a0, a1, lean] of [[deg(-150 + tilt), deg(-112 + tilt), -1], [deg(-68 + tilt), deg(-30 + tilt), 1]]) {
    const p0 = top(a0), p1 = top(a1), m = lerp(p0, p1, 0.5);
    const tip = [m[0] + lean * 12, m[1] - ry * 0.78];
    d.stroke([p0, tip, p1], { amp: 1.4, wl: 50, step: 4 });
  }
}
function earBlobs(d, cx, cy, rx, ry, color, tilt = 0) {
  const top = (a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  for (const [a0, a1, lean] of [[deg(-150 + tilt), deg(-112 + tilt), -1], [deg(-68 + tilt), deg(-30 + tilt), 1]]) {
    const p0 = top(a0), p1 = top(a1), m = lerp(p0, p1, 0.5);
    d.blob([p0, [m[0] + lean * 12, m[1] - ry * 0.78], p1, [m[0], m[1] + 20]], color, { smooth: false, amp: 2, offset: 0.6 });
  }
}

{
  const d = new Doodle("cat-sitting", 600, 600, 0.6);
  const H = [350, 220, 90, 74];
  const back = [[292, 276], [246, 320], [214, 392], [202, 462], [214, 514], [256, 536], [330, 538], [372, 534]];
  const chest = [[404, 284], [410, 344], [402, 420], [394, 480], [390, 534]];
  d.blob([...back, ...chest.slice().reverse()], C.blue);
  d.ellipseBlob(...H, C.blue);
  earBlobs(d, ...H, C.blue);
  d.curve(back);
  d.curve(chest);
  d.curve([[352, 446], [349, 492], [347, 532]], { amp: 1.4 });
  d.curve([[326, 536], [342, 524], [358, 536]], { amp: 0.8, wl: 30 });
  d.curve([[360, 536], [376, 526], [392, 536]], { amp: 0.8, wl: 30 });
  d.curve([[214, 506], [162, 524], [120, 504], [106, 460], [124, 424], [150, 428]], { amp: 2 });
  catEars(d, ...H);
  catHead(d, ...H);
  save("Cat", "cat-sitting.svg", "Cat, sitting", d, 0.34);
}

{
  const d = new Doodle("cat-loaf", 720, 460, 0.6);
  const H = [522, 288, 86, 72];
  const loaf = [[468, 230], [380, 206], [262, 210], [186, 240], [152, 300], [166, 356], [200, 372]];
  d.blob([...loaf, [470, 372], [500, 330]], C.blue);
  d.ellipseBlob(...H, C.blue);
  earBlobs(d, ...H, C.blue, -4);
  d.curve(loaf);
  d.curve([[170, 362], [210, 386], [320, 392], [430, 386], [476, 372], [492, 352]], { amp: 2 });
  d.curve([[440, 371], [455, 357], [472, 368]], { amp: 0.8, wl: 30 });
  catEars(d, ...H, -4);
  catHead(d, ...H, { sleepy: true });
  // z z
  d.stroke([[612, 150], [640, 148], [612, 180], [642, 178]], { amp: 1, wl: 30, step: 3 });
  d.stroke([[656, 96], [674, 95], [656, 116], [676, 115]], { amp: 0.8, wl: 20, step: 3 });
  save("Cat", "cat-loaf.svg", "Cat, loaf (sleeping)", d, 0.34);
}

{
  const d = new Doodle("cat-walking", 720, 480, 0.6);
  const H = [540, 196, 78, 64];
  const top = [[468, 222], [380, 206], [262, 206], [190, 228]];
  const rump = [[190, 228], [166, 262], [196, 300]];
  const belly = [[196, 300], [300, 314], [420, 304], [484, 252]];
  d.blob([...top, ...rump.slice(1), ...belly.slice(1)], C.blue);
  d.ellipseBlob(...H, C.blue);
  earBlobs(d, ...H, C.blue, 6);
  d.curve([...top, ...rump.slice(1)]);
  d.curve(belly);
  const leg = (x0, y0, x1, y1) => {
    const w = 11;
    d.curve([[x0 - w, y0], [(x0 + x1) / 2 - w, (y0 + y1) / 2], [x1 - w, y1], [x1 + 2, y1 + 6], [x1 + w + 8, y1], [(x0 + x1) / 2 + w, (y0 + y1) / 2], [x0 + w, y0]], { amp: 1.4, wl: 60 });
  };
  leg(222, 302, 196, 396);
  leg(264, 310, 284, 398);
  leg(404, 306, 388, 398);
  leg(444, 292, 470, 392);
  d.curve([[186, 232], [138, 200], [122, 140], [142, 96], [168, 100]], { amp: 2 });
  catEars(d, ...H, 6);
  catHead(d, ...H, { faceX: 14 });
  save("Cat", "cat-walking.svg", "Cat, walking", d, 0.34);
}

{
  // curled up asleep: a round body, head tucked on the front, tail wrapped round
  const d = new Doodle("cat-curled", 620, 440, 0.6);
  const H = [418, 300, 74, 60];
  d.ellipseBlob(300, 282, 168, 106, C.blue);
  d.ellipse(300, 282, 172, 110, { amp: 2.5 });
  d.curve([[136, 318], [170, 368], [250, 394], [340, 394], [404, 378], [440, 360]], { amp: 2 });
  d.solid(ellipsePts(...H), C.blue, { amp: 1.5, wl: 80 });
  catEars(d, ...H, 22);
  catHead(d, ...H, { sleepy: true, faceX: 8 });
  d.parts.push('<g class="zzz">');
  d.stroke([[506, 168], [534, 166], [506, 196], [536, 194]], { amp: 1, wl: 30, step: 3 });
  d.stroke([[552, 112], [570, 111], [552, 132], [572, 131]], { amp: 0.8, wl: 20, step: 3 });
  d.parts.push("</g>");
  save("Cat", "cat-curled.svg", "Cat, curled up asleep", d, 0.34);
}

{
  // stretching: front legs reaching forward, rump up, tail high
  const d = new Doodle("cat-stretching", 760, 440, 0.6);
  const H = [500, 312, 74, 60];
  const top = [[174, 214], [232, 192], [300, 214], [380, 268], [446, 318]];
  const rump = [[174, 214], [160, 250], [192, 282]];
  const belly = [[192, 282], [282, 302], [382, 332], [436, 356]];
  d.blob([...top, [440, 360], ...belly.slice().reverse(), ...rump.slice(1, 2)], C.blue);
  d.curve([...rump.slice().reverse(), ...top.slice(1)]);
  d.curve(belly);
  const leg = (x0, y0, x1, y1) => {
    const w = 11;
    d.curve([[x0 - w, y0], [(x0 + x1) / 2 - w, (y0 + y1) / 2], [x1 - w, y1], [x1 + 2, y1 + 6], [x1 + w + 8, y1], [(x0 + x1) / 2 + w, (y0 + y1) / 2], [x0 + w, y0]], { amp: 1.4, wl: 60 });
  };
  leg(214, 286, 204, 392);
  leg(252, 296, 262, 394);
  // front legs reaching forward and down to the ground, paws flat
  const strip = (p0, p1, w) => {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), nx = -dy / l * w, ny = dx / l * w;
    d.curve([[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny], [p1[0] + dx / l * 14, p1[1] + 4], [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]], { amp: 1.4, wl: 70 });
  };
  strip([430, 336], [592, 386], 11);
  strip([446, 352], [626, 392], 11);
  d.curve([[176, 216], [140, 170], [132, 110], [152, 72], [178, 76]], { amp: 2 });
  d.solid(ellipsePts(...H), C.blue, { amp: 1.5, wl: 80 });
  catEars(d, ...H, 18);
  catHead(d, ...H, { sleepy: true, faceX: 10 });
  save("Cat", "cat-stretching.svg", "Cat, stretching", d, 0.34);
}

/* =====================================================================
   SMALL DOODLES
   ===================================================================== */
function small(name, label, w, h, draw, display = 0.5, k = 0.2) {
  const d = new Doodle(name, w, h, k);
  d.amp = 1.6; d.wl = 40; d.off = d.off.map((v) => v * 1.9);
  draw(d);
  save("Small doodles", `${name}.svg`, label, d, display);
}

small("star", "Star", 200, 200, (d) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = deg(-90 + i * 36 + d.r(-3, 3)), r = i % 2 ? 31 : 74 * d.r(0.92, 1.05);
    pts.push([100 + r * Math.cos(a), 106 + r * Math.sin(a)]);
  }
  d.blob(pts, C.coral, { smooth: false, amp: 2 });
  d.stroke(pts, { loop: true, step: 3, amp: 1.2 });
});

small("sparkle", "Sparkle", 200, 200, (d) => {
  const c = [100, 100], tips = [[100, 20], [176, 100], [100, 182], [26, 100]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = tips[i], b = tips[(i + 1) % 4];
    const ctrl = [c[0] + (a[0] + b[0] - 2 * c[0]) * 0.1, c[1] + (a[1] + b[1] - 2 * c[1]) * 0.1];
    pts.push(...quadPts(a, ctrl, b, 14).slice(0, -1));
  }
  d.blob(pts, C.mustard, { smooth: false, amp: 2 });
  d.stroke(pts, { loop: true, step: 3, amp: 1.2 });
});

small("squiggle", "Squiggle", 320, 110, (d) => {
  const pts = [];
  for (let x = 20; x <= 300; x += 10) pts.push([x, 56 + 24 * Math.sin(((x - 20) / 280) * 3 * TAU) * (0.85 + 0.15 * Math.sin(x / 40))]);
  d.curve(pts, { amp: 1.4 });
});

small("loops", "Loops", 340, 140, (d) => {
  const pts = [];
  for (let t = 0.3; t <= 6 * Math.PI + 1.2; t += 0.15) pts.push([24 + 14.5 * t - 24 * Math.sin(t), 82 - 24 * Math.cos(t) - t * 1.6]);
  d.curve(pts, { amp: 1.2 });
});

small("heart", "Heart", 200, 200, (d) => {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * TAU;
    pts.push([100 + 4.3 * 16 * Math.sin(t) ** 3, 96 - 4.3 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  d.blob(pts, C.coral, { smooth: false });
  d.stroke(pts, { loop: true, step: 3 });
});

small("cloud", "Cloud", 220, 180, (d) => {
  const pts = [
    ...arcPts(62, 112, 27, deg(100), deg(250), 10),
    ...arcPts(96, 86, 34, deg(195), deg(330), 12),
    ...arcPts(136, 94, 29, deg(225), deg(355), 10),
    ...arcPts(160, 120, 21, deg(275), deg(440), 10),
    [130, 142], [92, 141],
  ];
  d.blob(pts, C.sky, { smooth: false, amp: 2.5 });
  d.stroke(pts, { loop: true, step: 3 });
});

small("flower", "Flower blob", 200, 200, (d) => {
  const pts = [];
  for (let i = 0; i < 90; i++) {
    const t = (i / 90) * TAU;
    pts.push([100 + 64 * (1 + 0.2 * Math.cos(5 * t + 0.4)) * Math.cos(t), 100 + 64 * (1 + 0.2 * Math.cos(5 * t + 0.4)) * Math.sin(t)]);
  }
  d.blob(pts, C.green, { smooth: false, amp: 2.5 });
  d.stroke(pts, { loop: true, step: 3 });
  d.ellipse(100, 100, 15, 14, { amp: 0.8 });
});

small("arrow", "Arrow", 200, 200, (d) => {
  d.curve([[26, 160], [44, 98], [100, 58], [168, 62]], { amp: 1.6 });
  d.stroke([[144, 40], [170, 62], [142, 86]], { amp: 1, step: 3 });
});

small("dots-dashes", "Dots and dashes", 340, 60, (d) => {
  let x = 22;
  for (const t of ["dot", "dash", "dot", "dot", "dash", "dot", "dash", "dash", "dot"]) {
    const y = 30 + d.r(-3, 3);
    if (t === "dot") { d.dot(x, y, 5.5); x += 30; }
    else { d.stroke([[x - 4, y], [x + 26, y + d.r(-3, 3)]], { amp: 0.8, wl: 30 }); x += 46; }
  }
});

small("sunburst", "Sun burst", 200, 200, (d) => {
  d.ellipseBlob(100, 100, 36, 35, C.mustard);
  d.ellipse(100, 100, 36, 35, { amp: 1 });
  for (let i = 0; i < 11; i++) {
    const a = deg(i * (360 / 11) + d.r(-6, 6)), r0 = d.r(50, 55), r1 = d.r(70, 84);
    d.stroke([[100 + r0 * Math.cos(a), 100 + r0 * Math.sin(a)], [100 + r1 * Math.cos(a), 100 + r1 * Math.sin(a)]], { amp: 0.8, wl: 30 });
  }
});

/* ---------- more small doodles ---------- */
small("spiral", "Spiral", 200, 200, (d) => {
  const pts = [];
  for (let t = 0; t <= 5.6 * Math.PI; t += 0.18) { const r = 5 + t * 3.6; pts.push([100 + r * Math.cos(t), 100 + r * Math.sin(t)]); }
  d.curve(pts, { amp: 1 });
});
small("zigzag", "Zigzag", 220, 100, (d) => {
  d.stroke([[16, 66], [48, 30], [80, 66], [112, 30], [144, 66], [176, 30], [204, 60]], { amp: 1, step: 3 });
});
small("plus", "Plus", 200, 200, (d) => {
  const a = 18, L = 62, c = 100;
  const pts = [[c - a, c - L], [c + a, c - L], [c + a, c - a], [c + L, c - a], [c + L, c + a], [c + a, c + a], [c + a, c + L], [c - a, c + L], [c - a, c + a], [c - L, c + a], [c - L, c - a], [c - a, c - a]];
  d.blob(pts, C.coral, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3, amp: 1 });
});
small("ring", "Ring", 200, 200, (d) => {
  d.ellipseBlob(100, 100, 46, 44, C.sky);
  d.ellipse(100, 100, 48, 46, { amp: 1.2 });
  d.ellipse(100, 100, 22, 21, { amp: 0.8 });
});
small("raindrop", "Raindrop", 200, 200, (d) => {
  const pts = [[100, 26], ...arcPts(100, 124, 46, deg(-28), deg(208), 24)];
  d.blob(pts, C.sky, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3 });
});
small("leaf", "Leaf", 200, 200, (d) => {
  const pts = [...quadPts([40, 162], [44, 52], [162, 38], 16).slice(0, -1), ...quadPts([162, 38], [150, 150], [40, 162], 16).slice(0, -1)];
  d.blob(pts, C.green, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3 });
  d.curve([[46, 156], [98, 104], [150, 50]], { amp: 0.8 });
});
small("bolt", "Lightning bolt", 200, 200, (d) => {
  const pts = [[112, 18], [60, 110], [98, 110], [78, 184], [148, 82], [108, 82], [134, 18]];
  d.blob(pts, C.mustard, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3, amp: 1 });
});
small("asterisk", "Asterisk", 200, 200, (d) => {
  for (const a of [90, 30, 150]) {
    const r = 62 * d.r(0.9, 1.05), c = Math.cos(deg(a)), s = Math.sin(deg(a));
    d.stroke([[100 - r * c, 100 - r * s], [100 + r * c, 100 + r * s]], { amp: 1, wl: 40 });
  }
});
small("planet", "Planet", 220, 200, (d) => {
  d.ellipseBlob(110, 100, 44, 44, C.coral);
  d.ellipse(110, 100, 46, 46, { amp: 1 });
  d.ellipse(110, 104, 96, 24, { rot: -0.3, amp: 1.2 });
});
small("moon", "Moon", 200, 200, (d) => {
  const pts = [...arcPts(100, 100, 66, deg(-60), deg(-300), 30), ...arcPts(126, 86, 52, deg(-245), deg(-65), 24)];
  d.blob(pts, C.mustard, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3 });
});
small("triangle", "Triangle", 200, 200, (d) => {
  const pts = [[100, 30], [170, 156], [30, 152]];
  d.blob(pts, C.blue, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3, amp: 1.2 });
});
small("diamond", "Diamond", 200, 200, (d) => {
  const pts = [[100, 24], [158, 100], [100, 176], [42, 100]];
  d.blob(pts, C.green, { smooth: false, amp: 1.5 });
  d.stroke(pts, { loop: true, step: 3, amp: 1.2 });
});
small("check", "Check mark", 200, 200, (d) => {
  d.stroke([[36, 104], [80, 148], [166, 48]], { amp: 1.2, step: 3 });
});
small("satellite", "Satellite", 240, 200, (d) => {
  const panels = [[22, 78, 66, 44], [152, 78, 66, 44]];
  for (const [x, y, w, h] of panels) d.blob(rrectPts(x, y, w, h, 3), C.blue, { smooth: false, amp: 1.2, offset: 0.6 });
  for (const [x, y, w, h] of panels) {
    d.stroke(rrectPts(x, y, w, h, 3), { loop: true, step: 2.5, amp: 0.8 });
    d.stroke([[x + w / 2, y + 2], [x + w / 2, y + h - 2]], { amp: 0.5 });
  }
  d.stroke([[88, 100], [100, 100]], { amp: 0.4 });
  d.stroke([[140, 100], [152, 100]], { amp: 0.4 });
  d.stroke(rrectPts(100, 80, 40, 40, 6), { loop: true, step: 2.5, amp: 0.8 });
  d.stroke([[120, 80], [120, 52]], { amp: 0.5 });
  d.dot(120, 48, 6);
});
small("scribble", "Scribble loop", 200, 200, (d) => {
  const pts = [];
  for (let t = 0; t <= 2.3 * TAU; t += 0.12) { const r = 52 + 10 * Math.sin(t * 1.7); pts.push([100 + r * Math.cos(t) + t * 2, 100 + r * 0.8 * Math.sin(t)]); }
  d.curve(pts, { amp: 1 });
});
small("emphasis", "Emphasis marks", 200, 140, (d) => {
  d.stroke([[62, 104], [38, 70]], { amp: 0.8 });
  d.stroke([[100, 94], [100, 50]], { amp: 0.8 });
  d.stroke([[138, 104], [162, 70]], { amp: 0.8 });
});

small("wave", "Wave lines", 220, 120, (d) => {
  for (const y of [40, 74]) {
    const pts = [];
    for (let x = 16; x <= 204; x += 8) pts.push([x, y + 10 * Math.sin((x - 16) / 188 * 2.5 * TAU)]);
    d.curve(pts, { amp: 0.8 });
  }
});
small("x-mark", "X mark", 200, 200, (d) => {
  d.stroke([[56, 56], [144, 146]], { amp: 1 });
  d.stroke([[146, 52], [58, 148]], { amp: 1 });
});
small("rainbow", "Rainbow", 240, 150, (d) => {
  const band = (r0, r1) => [...arcPts(120, 132, r1, Math.PI, TAU, 20), ...arcPts(120, 132, r0, TAU, Math.PI, 16)];
  d.blob(band(66, 92), C.coral, { smooth: false, amp: 1.2, offset: 0.5 });
  d.blob(band(40, 64), C.sky, { smooth: false, amp: 1.2, offset: 0.5 });
  for (const r of [96, 68, 40]) d.stroke(arcPts(120, 132, r, Math.PI, TAU, 20), { amp: 1 });
});
small("lightbulb", "Lightbulb", 200, 220, (d) => {
  const bulb = [...arcPts(100, 86, 50, deg(130), deg(410), 28), [122, 150], [78, 150]];
  d.blob(bulb, C.mustard, { smooth: false, amp: 1.5 });
  d.stroke(bulb, { loop: true, step: 3 });
  d.stroke([[80, 166], [120, 166]], { amp: 0.6 });
  d.stroke([[84, 180], [116, 180]], { amp: 0.6 });
  d.curve([[88, 150], [92, 112], [100, 124], [108, 112], [112, 150]], { amp: 0.6 });
});
small("pencil", "Pencil", 240, 120, (d) => {
  const body = [[40, 44], [180, 44], [180, 80], [40, 80]];
  d.blob(body, C.mustard, { smooth: false, amp: 1.2 });
  d.stroke(body, { loop: true, step: 3, amp: 0.8 });
  d.stroke([[180, 44], [218, 62], [180, 80]], { amp: 0.8, step: 3 });
  d.dot(212, 62, 4);
  d.stroke([[58, 44], [58, 80]], { amp: 0.5 });
  d.stroke([[40, 62], [180, 62]], { amp: 0.5 });
});
small("dot-trio", "Three dots", 220, 120, (d) => {
  d.dot(50, 64, 16, C.coral); d.dot(110, 50, 13, C.mustard); d.dot(166, 68, 15, C.blue);
  d.ellipse(50, 64, 17, 17, { amp: 0.8 }); d.ellipse(110, 50, 14, 14, { amp: 0.8 }); d.ellipse(166, 68, 16, 16, { amp: 0.8 });
});

/* =====================================================================
   LINES
   ===================================================================== */
{
  const d = new Doodle("ground-line", 1200, 40, 0.4);
  d.stretch = true;
  d.curve([[6, 23], [180, 20], [420, 22], [640, 19], [880, 22], [1060, 19], [1194, 21]], { amp: 2.2, wl: 110 });
  save("Lines", "ground-line.svg", "Ground line", d, "100%");
}
{
  const d = new Doodle("underline", 420, 40, 0.3);
  d.stretch = true;
  d.curve([[8, 30], [90, 22], [200, 19], [310, 18], [392, 13], [412, 8]], { amp: 1.8, wl: 70 });
  save("Lines", "underline.svg", "Heading underline", d, 0.62);
}
{
  const d = new Doodle("underline-double", 420, 46, 0.3);
  d.stretch = true;
  d.curve([[8, 24], [110, 18], [230, 17], [340, 14], [412, 9]], { amp: 1.8, wl: 70 });
  d.curve([[34, 38], [150, 31], [270, 30], [394, 25]], { amp: 1.8, wl: 70 });
  save("Lines", "underline-double.svg", "Heading underline, double pass", d, 0.62);
}

/* =====================================================================
   TRAIT DOODLES (About section)
   ===================================================================== */
// seed: defaults to the file name; pass the old name when a file is renamed so the drawing stays the same.
function trait(name, label, draw, seed = name) {
  const d = new Doodle(seed, 160, 160, 0.16);
  d.amp = 1.2; d.wl = 34; d.off = d.off.map((v) => v * 1.6);
  draw(d);
  save("Trait doodles", `${name}.svg`, label, d, 0.62);
}
trait("trait-curious", "Curious: magnifying glass", (d) => {
  d.ellipseBlob(64, 64, 38, 38, C.sky);
  d.ellipse(64, 64, 40, 40, { amp: 1 });
  d.curve(arcPts(64, 64, 26, deg(200), deg(255), 5), { amp: 0.6, wl: 20 });
  d.stroke([[93, 93], [138, 138]], { amp: 0.8 });
  d.stroke([[101, 89], [146, 132]], { amp: 0.8 });
  d.curve([[138, 138], [146, 140], [146, 132]], { amp: 0.4 });
});
trait("trait-whimsical", "Whimsical: paper plane", (d) => {
  const plane = [[150, 26], [72, 58], [100, 72], [150, 26], [108, 96], [100, 72]];
  d.blob([[150, 26], [72, 58], [100, 72], [108, 96]], C.coral, { smooth: false, amp: 1.5 });
  d.stroke(plane, { step: 2.5, amp: 0.9 });
  const trail = [];
  for (let t = 0; t <= TAU + 0.9; t += 0.2) trail.push([84 - 10 * t + 20 * Math.sin(t), 112 - 20 * Math.cos(t) + t * 4 - 30 + 30 * Math.cos(Math.min(t, 1.2))]);
  d.curve([[90, 80], ...trail.slice(1)], { amp: 0.8 });
});
trait("trait-relentless", "Relentless: mountain and flag", (d) => {
  const m = [[12, 142], [66, 54], [90, 92], [108, 70], [150, 142]];
  d.blob([...m], C.green, { smooth: false, amp: 1.6 });
  d.stroke([...m, [12, 142]], { step: 2.5, amp: 0.9 });
  d.blob([[66, 18], [98, 27], [66, 36]], C.coral, { smooth: false, amp: 1, offset: 0.4 });
  d.stroke([[66, 54], [66, 16]], { amp: 0.6 });
  d.stroke([[66, 18], [98, 27], [66, 36]], { step: 2.5, amp: 0.6 });
});
trait("trait-building", "Building with people: stacked blocks", (d) => {
  const blocks = [[16, 96, 62, 46, C.mustard], [82, 96, 62, 46, C.blue], [48, 48, 62, 46, C.coral]];
  for (const [x, y, w, h, c] of blocks) d.blob(rrectPts(x, y, w, h, 3), c, { smooth: false, amp: 1.5, offset: 0.7 });
  for (const [x, y, w, h] of blocks) d.stroke(rrectPts(x, y, w, h, 3), { loop: true, step: 2.5, amp: 0.8 });
}, "trait-builds");

/* =====================================================================
   BLOBS: soft colour shapes to sit behind drawings, no outline
   ===================================================================== */
for (const [name, color, label] of [["blob-sky", C.sky, "Soft blob, sky"], ["blob-mustard", C.mustard, "Soft blob, mustard"],
  ["blob-coral", C.coral, "Soft blob, coral"], ["blob-sky-2", C.sky, "Soft blob, sky (second shape)"],
  ["blob-mustard-2", C.mustard, "Soft blob, mustard (second shape)"], ["blob-green", C.green, "Soft blob, green"]]) {
  const d = new Doodle(name, 400, 320, 0.4);
  const pts = ellipsePts(200, 160, 170, 128, { rot: d.r(-0.3, 0.3) });
  d.off = [0, 0];
  d.blob(pts, color, { smooth: false, amp: 14, wl: 160, shrink: 1 });
  save("Blobs", `${name}.svg`, label, d, 0.4);
}

/* =====================================================================
   kit.html
   ===================================================================== */
function kitHtml() {
  const groups = [...new Set(KIT.map((k) => k.group))];
  const notes = {
    "Mascot": "Redrawn from the mascot reference in the doodle style. Eight poses, each used at most once on the site.",
    "Cat": "An original cat. Five poses, each used at most once on the site.",
    "Small doodles": "Ten scatter pieces for hero edges and section breaks.",
    "Lines": "Ground line for characters to stand on, and underlines for headings.",
    "Trait doodles": "One per trait in the About section.",
    "Blobs": "Soft colour shapes, no outline, to sit behind a drawing.",
  };
  const card = (k) => {
    const wide = k.display === "100%";
    const style = wide ? "width:100%" : `width:${Math.round(k.w * k.display)}px;max-width:100%`;
    return `      <figure class="card${wide ? " card--wide" : ""}">
        <div class="art"><img src="doodles/${k.file}" alt="${k.label}" style="${style}" loading="lazy"></div>
        <figcaption><strong>${k.label}</strong><code>${k.file}</code></figcaption>
      </figure>`;
  };
  const swatches = Object.entries(C).map(([n, v]) => `      <li><span class="chip" style="background:var(--${n})"></span><strong>${n}</strong><code>${v}</code></li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doodle kit</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="../assets/css/tokens.css">
<style>
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);color:var(--ink);font-family:var(--font-body);line-height:1.5}
  main{max-width:1120px;margin:0 auto;padding:48px 16px 96px}
  h1,h2{font-family:var(--font-display);font-weight:500;font-variation-settings:"SOFT" 100;letter-spacing:-0.01em;margin:0}
  h1{font-size:clamp(2rem,5vw,3rem)}
  h2{font-size:1.6rem;margin-top:64px}
  .head-u{display:block;width:180px;margin:4px 0 6px}
  p{max-width:62ch;margin:.5rem 0 0}
  code{font-size:.8rem;opacity:.7}
  .palette{list-style:none;padding:0;margin:20px 0 0;display:flex;flex-wrap:wrap;gap:12px}
  .palette li{display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;border:1.5px solid var(--ink);border-radius:999px;background:#fffcf4}
  .chip{width:28px;height:28px;border-radius:50%;border:1.5px solid var(--ink)}
  .palette code{opacity:.6}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin-top:20px}
  .grid--small{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}
  .card{margin:0;border:1.5px solid rgba(20,20,20,.18);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;background:rgba(255,252,244,.5)}
  .card--wide{grid-column:1/-1}
  .art{flex:1;display:flex;align-items:center;justify-content:center;min-height:120px}
  .art img{height:auto;display:block}
  figcaption{display:flex;flex-direction:column;font-size:.9rem}
  .scene{position:relative;margin-top:20px;padding:24px 0 0}
  .scene .row{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:0 6%}
  .scene .row img{display:block;height:auto}
  .scene .ground{display:block;width:100%;margin-top:-6px}
</style>
</head>
<body>
<main>
  <h1>Doodle kit</h1>
  <img class="head-u" src="doodles/underline.svg" alt="">
  <p>Every asset is generated by <code>tools/doodles.mjs</code> from clean geometry plus seeded wobble, so they share one hand. Outlines are 3px ink at any size; colour sits underneath, off-register.</p>

  <h2>Palette</h2>
  <ul class="palette">
${swatches}
  </ul>

  <h2>Together</h2>
  <p>Scale check: mascot and cat on the ground line.</p>
  <div class="scene">
    <div class="row">
      <img src="doodles/cat-loaf.svg" alt="" style="width:150px">
      <img src="doodles/mascot-waving.svg" alt="" style="width:220px">
      <img src="doodles/cat-sitting.svg" alt="" style="width:120px">
    </div>
    <img class="ground" src="doodles/ground-line.svg" alt="">
  </div>
${groups.map((g) => `
  <h2>${g}</h2>
  <p>${notes[g] ?? ""}</p>
  <div class="grid${["Small doodles", "Trait doodles"].includes(g) ? " grid--small" : ""}">
${KIT.filter((k) => k.group === g).map(card).join("\n")}
  </div>`).join("\n")}
</main>
</body>
</html>
`;
}

fs.writeFileSync(path.join(DESIGN, "kit.html"), kitHtml());
console.log(`wrote ${KIT.length} SVGs to assets/doodles and kit.html`);
