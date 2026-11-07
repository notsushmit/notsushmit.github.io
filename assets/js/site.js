// Optional enhancements. The page works fully without this file.
(() => {
  const d = document;

  // 1. Underline the nav link for the section in view.
  const links = [...d.querySelectorAll('.site-nav a[href^="#"]')];
  const mark = (hash) => links.forEach((a) => a.hash === hash ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current"));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) mark(e.target.id === "hero" ? "" : "#" + e.target.id);
    }), { rootMargin: "-40% 0px -55% 0px" });
    ["#hero", ...new Set(links.map((a) => a.hash))].forEach((h) => { const s = d.querySelector(h); if (s) io.observe(s); });
  }

  // Close the phone menu after choosing a section.
  const panel = d.getElementById("nav-panel");
  if (panel && panel.hidePopover) panel.addEventListener("click", (e) => { if (e.target.closest("a")) panel.hidePopover(); });

  // 2. Mascot pupils follow the cursor a little: mouse only, never with reduced motion.
  const svg = d.querySelector(".hero__scene .mascot svg");
  const ok = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  if (!svg || !ok.matches || !window.DOMPoint) return;
  const eyes = [...svg.querySelectorAll(".pupil")].map((g) => {
    const b = g.getBBox();
    return { g, x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  let ev, raf = 0;
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    ev = e;
    raf = raf || requestAnimationFrame(() => {
      raf = 0;
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
      eyes.forEach((o) => {
        const dx = p.x - o.x, dy = p.y - o.y, l = Math.hypot(dx, dy) || 1, k = Math.min(l / 500, 1) * 9 / l;
        o.g.style.transform = `translate(${(dx * k).toFixed(1)}px,${(dy * k).toFixed(1)}px)`;
      });
    });
  }, { passive: true });
})();
