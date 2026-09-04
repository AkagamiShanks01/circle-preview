/* THE CIRCLE — scroll-scrubbed film (THE FORGING) · Engine v3
 * Codex-Audit-Fixes: Single-Flight-Cache (kein Doppel-Download), Byte-Limit
 * statt Frame-Limit, echte Coarse-Mindestparallelitaet, AbortController mit
 * Ziel-Prioritaet, Orientation-Re-Init, Fehler-Degradation auf CSS-Poster,
 * Reduced-Motion = Poster ohne Engine, Read/Write-Batching.
 * Rebuild 2026-09-03: Kapitel-Marker und Videos entfernt, Frame-Counter nur ?debug=1.
 */
(() => {
  "use strict";

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.body.classList.add("js-on");

  // ── Debug-Modus (?debug=1): Frame-Counter zum Kalibrieren der Film-Zuordnung ──
  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
  if (DEBUG) document.getElementById("marginalia")?.removeAttribute("hidden");

  // ── Szenen-Copy: Beat-Choreografie (auch ohne Film-Engine) ──
  const pins = [...document.querySelectorAll(".scene .pin")].map((el) => ({
    el, section: el.closest(".scene"), static: false,
  }));
  function classifyPins() {
    for (const p of pins) {
      const wasStatic = p.static;
      p.static = getComputedStyle(p.el).position !== "sticky";
      if (p.static && !wasStatic) {
        // Statische Pins (Mobil): alle Choreografie-Reste zuruecksetzen, sonst bleiben
        // Reveal-Zeilen nach einem Viewport-Wechsel unsichtbar
        p.el.style.opacity = ""; p.el.style.transform = "";
        for (const l of p.lines || []) { l.style.opacity = ""; l.style.transform = ""; }
        for (const f of p.focus || []) f.classList.add("on");
        p.focusIdx = -1;
      }
    }
  }
  classifyPins();
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * (2 - t));
  // Pro Pin: Zeilen-Reveal (Ueberschriften) und Fokus-Liste (Sektoren) vorab einsammeln
  for (const pn of pins) {
    pn.lines = [...pn.el.querySelectorAll(".reveal span")];
    pn.focus = [...pn.el.querySelectorAll("[data-focus] > p")];
    pn.focusIdx = -1;
  }
  classifyPins(); // erneut, jetzt mit lines/focus bekannt (statische Pins bekommen alle Absaetze hell)
  const grainEl = document.getElementById("grain");
  function choreograph() {
    // Erst alle Layout-Reads, dann alle Style-Writes (kein Thrashing)
    const reads = [];
    for (const pn of pins) {
      if (pn.static) continue;
      reads.push([pn, pn.section.getBoundingClientRect()]);
    }
    const lastSection = pins[pins.length - 1].section;
    for (const [pn, r] of reads) {
      const span = Math.max(1, r.height - innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / span));
      const inF = r.top > 0 ? ease(1 - r.top / (innerHeight * 0.55)) : 1;
      const outF = pn.section === lastSection ? 1 : 1 - ease((p - 0.84) / 0.10);
      const o = Math.min(inF, outF);
      pn.el.style.opacity = o.toFixed(3);
      // Copy driftet 2vh langsamer als der Scroll (dritte Ebene neben Film und Grain)
      const drift = (1 - inF) * 4 - p * 2;
      pn.el.style.transform = o > 0.02 ? `translateY(${drift.toFixed(2)}vh)` : "translateY(4vh)";
      // Zeilen-Reveal: jede Zeile 0.12 spaeter, ueber 0.5 der Einblendung
      for (let i = 0; i < pn.lines.length; i++) {
        const li = ease((inF - i * 0.12) / 0.5);
        const s = pn.lines[i].style;
        s.opacity = li.toFixed(3);
        s.transform = li < 0.999 ? `translateY(${((1 - li) * 0.4).toFixed(3)}em)` : "";
      }
      // Fokus-Liste: der aktive Absatz folgt dem Sektionsfortschritt zwischen 10% und 84%
      if (pn.focus.length) {
        const n = pn.focus.length;
        const t = Math.min(0.999, Math.max(0, (p - 0.10) / 0.74));
        const idx = inF < 0.5 ? 0 : Math.floor(t * n);
        if (idx !== pn.focusIdx) {
          pn.focus.forEach((el, i) => el.classList.toggle("on", i === idx));
          pn.focusIdx = idx;
        }
      }
    }
    if (grainEl) grainEl.style.backgroundPosition = `0 ${(-(scrollY * 0.3) % 300).toFixed(1)}px`;
  }

  const pbar = document.getElementById("pbar");
  const fcountEl = DEBUG ? document.getElementById("fcount") : null;
  function progress() {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }

  // ── Reduced Motion: CSS-Poster bleibt, keine Frame-Engine, nur Copy ──
  if (reduced) {
    const tick = () => { choreograph(); pbar.style.transform = `scaleX(${progress()})`; };
    addEventListener("scroll", tick, { passive: true });
    addEventListener("resize", () => { classifyPins(); tick(); });
    tick();
    return;
  }

  // ── Feature-Gate: ohne Bitmap-Support bleibt das CSS-Poster stehen ──
  if (!("createImageBitmap" in window) || !document.getElementById("film").getContext) return;

  const canvas = document.getElementById("film");
  const ctx = canvas.getContext("2d", { alpha: false });

  // Orientierungs-abhaengige Konfiguration (Re-Init bei Wechsel)
  const portraitMQ = matchMedia("(orientation: portrait)");
  function makeConfig() {
    const portrait = portraitMQ.matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const small = innerWidth * dpr <= 1024;
    const total = (portrait || small) ? 817 : 1225;   // seq6-Sets (Master v2, 40.8s, Baum-Sequenz)
    // Fine-Ebene nur so gross dekodieren, wie das Canvas wirklich zeichnet
    // (Frames 16:9 bzw. 9:16, cover-geskalattet) — schont Decode/Budget und
    // eliminiert Eviction-Churn, ohne jemals weicher als nativ zu sein.
    const vw = Math.round(innerWidth * dpr), vh = Math.round(innerHeight * dpr);
    const fineWidth = portrait
      ? Math.max(720, Math.min(1080, Math.ceil(Math.max(vw, vh * 0.5625))))
      : Math.max(960, Math.min(2560, Math.ceil(Math.max(vw, (vh * 16) / 9))));
    return {
      portrait, small,
      dir: portrait ? "seqp6" : (small ? "seqm6" : "seq6"),
      total,
      start: portrait ? 14 : 0,  // Mobil startet der Film mit sichtbarem Ring statt Void
      end: total - 1,  // Film laeuft bis zur letzten Scroll-Position durch (Nicolas 2026-08-26)
      window: (portrait || small) ? 14 : 40,
      coarseStep: (portrait || small) ? 24 : 16,
      coarseWidth: (portrait || small) ? 540 : 1024,  // Coarse klein dekodieren (Byte-Fix)
      fineWidth,
      byteCap: (portrait || small) ? 140e6 : 320e6,   // hartes Dekodier-Byte-Limit (420 -> 320: Renderer-Crash-Fix 2026-09-04)
    };
  }
  let C = makeConfig();
  const FILM_END = 0.86;    // Anteil des Scrolls, an dem der Film sein letztes Bild erreicht
  const MAX_INFLIGHT = 10;
  const COARSE_MIN = 2;     // echte Mindestparallelitaet der Basis-Ebene
  const MAX_RETRY = 2;

  const pad = (n) => String(n).padStart(4, "0");
  const src = (i) => `${C.dir}/f${pad(i + 1)}.webp`;

  // Single-Flight: ein Eintrag pro Frame-Index, Ebene ist Eigenschaft, nicht Key
  const coarse = new Map();   // i -> {bm, bytes}
  const fine = new Map();     // i -> {bm, bytes}
  const pending = new Map();  // i -> {ctrl, isCoarse}
  const failures = new Map();
  let inflightFine = 0, inflightCoarse = 0;
  let fineBytes = 0, coarseBytes = 0;
  let epoch = 0;              // Orientation-Generation
  let dirty = true;
  let current = 0;
  let targetFrame = 0;

  function entryBytes(bm) { return bm.width * bm.height * 4; }

  // Blob-Cache: komprimierte WebP-Bytes ALLER Frames im RAM (~40MB Desktop) —
  // nach dem Voll-Preload ist der Scrub komplett netzwerkfrei, nur noch Decode.
  const blobs = new Map();
  async function getBlob(i, signal) {
    const cached = blobs.get(i);
    if (cached) return cached;
    const r = await fetch(src(i), signal ? { signal } : undefined);
    if (!r.ok) throw new Error(`f${i}: ${r.status}`);
    const blob = await r.blob();
    blobs.set(i, blob);
    return blob;
  }

  // iOS-Safari kennt die resizeWidth-Option nicht (TypeError) — Fallback:
  // voll dekodieren und ueber ein kleines Canvas selbst herunterskalieren.
  let bitmapOptionsOk = true;
  async function decodeScaled(blob, targetW, quality) {
    if (bitmapOptionsOk) {
      try {
        return await createImageBitmap(blob, { resizeWidth: targetW, resizeQuality: quality || "medium" });
      } catch (e) {
        if (e instanceof TypeError || e.name === "InvalidStateError") bitmapOptionsOk = false;
        else throw e;
      }
    }
    const full = await createImageBitmap(blob);
    const h = Math.round(full.height * targetW / full.width);
    const c = document.createElement("canvas");
    c.width = targetW; c.height = h;
    c.getContext("2d").drawImage(full, 0, 0, targetW, h);
    full.close?.();
    return c; // Canvas ist drawImage-faehig und hat width/height
  }
  async function fetchBitmap(i, ctrl, resizeWidth, quality) {
    const blob = await getBlob(i, ctrl.signal);
    return resizeWidth ? decodeScaled(blob, resizeWidth, quality) : createImageBitmap(blob);
  }

  // Standin-Ebene (nur Desktop): das kleine seqm6-Set (~17MB) als Sofort-Film,
  // waehrend das scharfe seq6-Set still nachlaedt.
  const STANDIN_TOTAL = 817;
  const useStandin = !C.portrait && !C.small;
  const standinBlobs = new Map();   // j -> Blob (seqm6)
  const standin = new Map();        // j -> ImageBitmap
  const standinPending = new Set();
  const toStandin = (i) => Math.round(i * (STANDIN_TOTAL - 1) / (C.total - 1));
  async function getStandinBlob(j) {
    const c = standinBlobs.get(j);
    if (c) return c;
    const r = await fetch(`seqm6/f${pad(j + 1)}.webp`);
    if (!r.ok) throw new Error(`m${j}`);
    const blob = await r.blob();
    standinBlobs.set(j, blob);
    return blob;
  }
  function standinAt(i) {
    if (!useStandin) return null;
    const j = toStandin(i);
    for (let d = 0; d <= 4; d++) {
      const a = standin.get(j - d); if (a) return a;
      const b = standin.get(j + d); if (b) return b;
    }
    // dekodiere on demand aus lokalem Blob (schnell, kein Netz)
    for (let d = 0; d <= 2; d++) {
      for (const k of [j + d, j - d]) {
        if (k < 0 || k >= STANDIN_TOTAL || standin.has(k) || standinPending.has(k)) continue;
        const blob = standinBlobs.get(k);
        if (!blob) continue;
        standinPending.add(k);
        decodeScaled(blob, 1280)
          .then((bm) => { standin.set(k, bm); dirty = true; wake(); })
          .catch(() => {})
          .finally(() => standinPending.delete(k));
      }
    }
    // Fenster klein halten (24 statt 90: 90 x 1600px-Bitmaps ~ 500MB liessen den
    // Renderer bei ~70% Scroll abstuerzen, gemessen 2026-09-04 headless Chromium)
    if (standin.size > 24) {
      let worst = -1, wd = -1;
      for (const k of standin.keys()) { const d = Math.abs(k - j); if (d > wd) { wd = d; worst = k; } }
      standin.get(worst)?.close?.(); standin.delete(worst);
    }
    return null;
  }

  // Zweistufiger Voll-Preload: Phase 1 = Standin-Blobs (schnell nutzbar),
  // Phase 2 = scharfes Zielset. Hohe Parallelitaet gegen die Tunnel-Latenz.
  let warmInflight = 0, warmNext = 0, warmEpoch = epoch, warmPhase = useStandin ? 1 : 2;
  const WARM_PAR = 10;
  function warm() {
    if (warmEpoch !== epoch) { warmNext = 0; warmEpoch = epoch; warmPhase = (!C.portrait && !C.small) ? 1 : 2; }
    while (warmInflight < WARM_PAR) {
      if (warmPhase === 1) {
        if (warmNext >= STANDIN_TOTAL) { warmPhase = 2; warmNext = 0; continue; }
        const j = warmNext++;
        if (standinBlobs.has(j)) continue;
        warmInflight++;
        getStandinBlob(j).catch(() => {})
          .finally(() => { warmInflight--; updateLoader(); warm(); });
      } else {
        if (warmNext > C.end) return;
        const i = warmNext++;
        if (blobs.has(i)) continue;
        warmInflight++;
        getBlob(i).catch(() => {})
          .finally(() => { warmInflight--; updateLoader(); warm(); });
      }
    }
  }

  function request(i, isCoarse) {
    if (pending.has(i)) return;
    if ((failures.get(i) || 0) > MAX_RETRY) return;
    if (fine.has(i) || (isCoarse && coarse.has(i))) return;
    if (isCoarse ? inflightCoarse >= COARSE_MIN : inflightFine >= MAX_INFLIGHT - COARSE_MIN) return;
    const ctrl = new AbortController();
    const myEpoch = epoch;
    pending.set(i, { ctrl, isCoarse });
    isCoarse ? inflightCoarse++ : inflightFine++;
    fetchBitmap(i, ctrl, isCoarse ? C.coarseWidth : C.fineWidth, isCoarse ? "medium" : "high")
      .then((bm) => {
        if (myEpoch !== epoch) { bm.close?.(); return; }
        failures.delete(i);
        if (isCoarse) {
          coarse.set(i, bm); coarseBytes += entryBytes(bm);
        } else {
          if (Math.abs(i - targetFrame) > C.window * 1.5) { bm.close?.(); return; }
          fine.set(i, bm); fineBytes += entryBytes(bm);
        }
        dirty = true; wake();
      })
      .catch((e) => { if (e.name !== "AbortError") failures.set(i, (failures.get(i) || 0) + 1); })
      .finally(() => {
        pending.delete(i);
        isCoarse ? inflightCoarse-- : inflightFine--;
        pump();
      });
  }

  function pump() {
    const center = targetFrame;  // Ziel priorisieren, nicht den gelerpten Zwischenstand
    // Veraltete Fine-Requests abbrechen
    for (const [i, p] of pending) {
      if (!p.isCoarse && Math.abs(i - center) > C.window * 1.5) p.ctrl.abort();
    }
    // Basis-Ebene: naechste Coarse-Anker zuerst
    const anchor = Math.round(center / C.coarseStep) * C.coarseStep;
    for (let d = 0; inflightCoarse < COARSE_MIN && d * C.coarseStep <= C.end; d++) {
      for (const i of [anchor + d * C.coarseStep, anchor - d * C.coarseStep]) {
        if (i >= 0 && i <= C.end) request(i, true);
      }
    }
    // Fein-Fenster um das Ziel
    for (let d = 0; d <= C.window && inflightFine < MAX_INFLIGHT - COARSE_MIN; d++) {
      for (const i of [center + d, center - d]) {
        if (i >= 0 && i <= C.end) request(i, false);
      }
    }
    updateLoader();
  }

  function evict() {
    const center = targetFrame;
    const lim = Math.round(C.window * 1.5);
    for (const [k, bm] of fine) {
      if (k < center - lim || k > center + lim) {
        fineBytes -= entryBytes(bm); bm.close?.(); fine.delete(k);
      }
    }
    // Byte-Cap: entfernteste Fine-Frames zuerst opfern
    while (fineBytes + coarseBytes > C.byteCap && fine.size > 4) {
      let worst = -1, wd = -1;
      for (const k of fine.keys()) {
        const d = Math.abs(k - center);
        if (d > wd) { wd = d; worst = k; }
      }
      const bm = fine.get(worst);
      fineBytes -= entryBytes(bm); bm.close?.(); fine.delete(worst);
    }
  }

  function clearAll() {
    blobs.clear(); standinBlobs.clear();
    for (const [, bm] of standin) bm.close?.();
    standin.clear();
    for (const [, p] of pending) p.ctrl.abort();
    for (const [, bm] of fine) bm.close?.();
    for (const [, bm] of coarse) bm.close?.();
    fine.clear(); coarse.clear(); failures.clear();
    fineBytes = coarseBytes = 0;
  }
  addEventListener("pagehide", clearAll);

  // ── Loader: zaehlt Phase 1 (Sofort-Set) bis 100%, HD laedt danach still ──
  let loaderDone = false, loaderStart = performance.now();
  function updateLoader() {
    if (loaderDone) return;
    const phase1Total = useStandin ? STANDIN_TOTAL : C.end + 1;
    const have = useStandin ? standinBlobs.size : Math.min(blobs.size, C.end + 1);
    if (have >= phase1Total) {
      loaderDone = true;
      document.getElementById("loader")?.remove();
      return;
    }
    let el = document.getElementById("loader");
    if (!el) {
      el = document.createElement("div");
      el.id = "loader";
      el.innerHTML = '<span class="loader-label"></span><span class="bar"></span>';
      document.body.appendChild(el);
    }
    const pct = Math.min(99, Math.round((have / phase1Total) * 100));
    const slow = performance.now() - loaderStart > 30000;
    el.querySelector(".loader-label").textContent =
      (slow ? "SLOW CONNECTION — " : "") + "LOADING FILM " + pct + "%";
    el.style.setProperty("--p", (pct / 100).toFixed(3));
  }

  // ── Canvas ───────────────────────────────
  let cw = 0, ch = 0, resizeTimer = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (w === cw && h === ch) return;
    cw = canvas.width = w;
    ch = canvas.height = h;
    dirty = true;
  }
  resize();

  function reinitIfConfigChanged() {
    const next = makeConfig();
    if (next.dir === C.dir && Math.abs(next.fineWidth - C.fineWidth) <= C.fineWidth * 0.25) return;
    if (next.dir !== C.dir) {
      epoch++;
      clearAll();
      C = next;
      loaderDone = false; loaderStart = performance.now();
      current = targetFrame = Math.round(Math.min(1, progress() / FILM_END) * C.end);
    } else {
      // Nur Aufloesungs-Drift: Bitmaps neu dekodieren, Blob-Cache bleibt warm
      C.fineWidth = next.fineWidth;
      for (const [, bm] of fine) bm.close?.();
      for (const [, bm] of coarse) bm.close?.();
      fine.clear(); coarse.clear();
      fineBytes = coarseBytes = 0;
    }
    dirty = true;
    pump();
  }
  function onViewportChange() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); classifyPins(); reinitIfConfigChanged(); wake(); }, 150);
  }
  addEventListener("resize", onViewportChange);
  portraitMQ.addEventListener?.("change", onViewportChange);
  visualViewport?.addEventListener("resize", onViewportChange);
  // In-App-WebViews melden beim Start falsche Groessen — nach dem Settle nachpruefen
  setTimeout(onViewportChange, 600);
  setTimeout(onViewportChange, 2000);

  function bestAt(i) {
    const f = fine.get(i);
    if (f) return f;
    for (let d = 1; d <= 6; d++) {
      const a = fine.get(i - d); if (a) return a;
      const b = fine.get(i + d); if (b) return b;
    }
    const st = standinAt(i);
    if (st) return st;
    let best = null, bd = Infinity;
    for (const k of coarse.keys()) {
      const d = Math.abs(k - i);
      if (d < bd) { bd = d; best = k; }
    }
    return best !== null ? coarse.get(best) : null;
  }

  function drawImageCover(img, alpha) {
    const s = Math.max(cw / img.width, ch / img.height);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (cw - img.width * s) / 2, (ch - img.height * s) / 2, img.width * s, img.height * s);
  }

  let firstDraw = false;
  function render() {
    const lo = Math.floor(current);
    const hi = Math.min(C.end, lo + 1);
    const frac = current - lo;
    const a = bestAt(lo);
    if (!a) return; // CSS-Poster bleibt sichtbar, bis das erste Bitmap da ist
    const b = hi !== lo ? bestAt(hi) : null;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, cw, ch);
    drawImageCover(a, 1);
    if (b && b !== a && frac > 0.02) drawImageCover(b, frac);
    ctx.globalAlpha = 1;
    if (!firstDraw) { firstDraw = true; canvas.style.backgroundImage = "none"; }
  }

  // ── Scrub-Loop mit Idle-Stopp ────────────
  let rafActive = false;
  function wake() {
    if (!rafActive) { rafActive = true; requestAnimationFrame(raf); }
  }
  function raf() {
    const p = progress();
    // Film endet bei FILM_END des Scrolls und haelt das Schlussbild unter Founders/Contact
    const pf = Math.min(1, p / FILM_END);
    const target = C.start + pf * (C.end - C.start);
    targetFrame = Math.round(target);
    const settled = Math.abs(target - current) <= 0.002;
    if (!settled) {
      current += (target - current) * 0.16;
      if (Math.abs(target - current) < 0.002) current = target;
      pump(); evict();
      dirty = true;
    }
    choreograph();
    if (fcountEl) fcountEl.textContent = `F ${pad(Math.round(current) + 1)} / ${pad(C.total)}`;
    pbar.style.transform = `scaleX(${p})`;
    if (dirty) { render(); dirty = false; }
    if (settled && !dirty) { rafActive = false; return; }
    requestAnimationFrame(raf);
  }

  addEventListener("scroll", wake, { passive: true });
  pump();
  warm();
  wake();
})();
