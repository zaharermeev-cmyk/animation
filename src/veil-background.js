/**
 * VeilBackground — анимированный фон по референсу:
 *  - 3D-тоннель из плиток: пол уходит к горизонту в центре экрана и
 *    загибается в стены и потолок;
 *  - объёмные вуали из сотен нитей с мягким свечением и искрами;
 *  - на пол можно ставить DOM-объекты (bg.place) — они стоят «на земле»,
 *    масштабируются по глубине и отбрасывают контактную тень.
 *
 * Интро: пустой экран → от центра материализуются плитки → вырастают вуали.
 * Цвета — из CSS-переменных (--veil-*), фон сам подстраивается под тему.
 */

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));

export const DEFAULTS = {
  // вуали
  ribbons: 7, // пучков с каждой стороны
  strandsPerRibbon: 26, // нитей в пучке
  wisps: 0.12, // доля «выбившихся» нитей
  points: 64, // точек на нить
  glints: 42, // искр
  bloom: 0.9, // сила свечения
  strandOpacity: 1,
  // пол / тоннель
  tile: 0.4, // размер плитки в мировых единицах
  camHeight: 1, // высота камеры над полом
  near: 1.1,
  far: 26,
  curve: 0.034, // насколько пол загибается в стены
  ceiling: 0.6, // яркость потолка относительно пола
  fog: 1.0, // затухание сетки вдали
  fov: 0.85,
  gridOpacity: 1,
  // общее
  speed: 1,
  parallax: true,
  maxDpr: 1.5,
  seed: 11,
  intro: {
    delay: 0.5, // пустой экран, с
    grid: 2.8, // проявление плиток
    veilsAt: 1.8, // старт вуалей
    veils: 2.8,
  },
};

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const probe = document.createElement('canvas').getContext('2d');
function parseColor(str, fallback) {
  if (!str || !str.trim()) return fallback;
  probe.fillStyle = '#000';
  probe.fillStyle = str.trim();
  const v = probe.fillStyle;
  if (v[0] === '#') {
    return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
  }
  const m = v.match(/[\d.]+/g);
  return [+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1];
}
const rgba = (c, a = 1) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(c[3] * a, 0, 1).toFixed(4)})`;
const mixColor = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];

export class VeilBackground {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { ...DEFAULTS, ...options, intro: { ...DEFAULTS.intro, ...options.intro } };
    this.root = document.documentElement;

    // слой вуалей и слой свечения
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.bloomCanvas = document.createElement('canvas');
    this.bctx = this.bloomCanvas.getContext('2d');

    this.time = 0;
    this.clock = 0;
    this.running = false;
    this.raf = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.objects = [];

    this.reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
    if (this.reducedMq.matches) this.clock = 1e3;

    this.palette = this.readPalette();
    this.transition = null;

    this.build();
    this.resize();
    this.prepareCamera();

    this.onResize = () => this.resize();
    this.onVisibility = () => (document.hidden ? this.pause() : this.resume());
    this.onPointer = (e) => {
      this.pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    };
    this.onTheme = () => requestAnimationFrame(() => this.refreshTheme());

    addEventListener('resize', this.onResize);
    addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.themeObserver = new MutationObserver(this.onTheme);
    this.themeObserver.observe(this.root, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  }

  /* ---------- публичное API ---------- */

  start() {
    this.running = true;
    this.resume();
    return this;
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume() {
    if (!this.running || this.raf || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  replay() {
    this.clock = 0;
  }

  configure(options) {
    const rebuild = ['ribbons', 'strandsPerRibbon', 'points', 'glints', 'seed', 'wisps'].some(
      (k) => k in options && options[k] !== this.opts[k]
    );
    Object.assign(this.opts, options);
    if (rebuild) this.build();
  }

  /**
   * Поставить DOM-элемент на пол.
   *   { col, row }  — плитка: col 0 — справа от центра, -1 — слева; row 0 — ближайший ряд
   *   { x, z }      — или мировые координаты (x — вбок, z — вглубь)
   *   height        — высота объекта в мировых единицах (плитка = opts.tile)
   *   shadow        — контактная тень/свечение под объектом (по умолчанию да)
   * Нижний центр элемента ставится в точку на полу.
   */
  place(el, { col, row, x, z, height = 1, shadow = true } = {}) {
    if (x === undefined) x = (col + 0.5) * this.opts.tile;
    if (z === undefined) z = this.opts.near + 1.2 + (row + 0.5) * this.opts.tile;
    Object.assign(el.style, { position: 'fixed', left: '0', top: '0', transformOrigin: '0 0', margin: '0', opacity: '0' });
    const obj = { el, x, z, height, shadow };
    this.objects.push(obj);
    return obj;
  }

  remove(el) {
    this.objects = this.objects.filter((o) => o.el !== el);
  }

  refreshTheme() {
    const to = this.readPalette();
    this.transition = { from: this.currentPalette(), to, t: 0 };
    this.palette = to;
  }

  destroy() {
    this.running = false;
    this.pause();
    removeEventListener('resize', this.onResize);
    removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.themeObserver.disconnect();
  }

  /* ---------- тема ---------- */

  readPalette() {
    const cs = getComputedStyle(this.root);
    const v = (name) => cs.getPropertyValue(name);
    return {
      a: parseColor(v('--veil-a'), [230, 196, 143, 1]),
      b: parseColor(v('--veil-b'), [159, 184, 255, 1]),
      grid: parseColor(v('--veil-grid'), [150, 170, 215, 0.14]),
      glint: parseColor(v('--veil-glint'), [255, 244, 220, 1]),
      shadow: parseColor(v('--veil-shadow'), [120, 150, 220, 0.25]),
      additive: v('--veil-blend').trim() !== 'normal',
      intensity: parseFloat(v('--veil-intensity')) || 1,
    };
  }

  currentPalette() {
    const tr = this.transition;
    if (!tr) return this.palette;
    const t = smooth(clamp(tr.t, 0, 1));
    const { from, to } = tr;
    const dip = from.additive !== to.additive ? 1 - 0.85 * Math.sin(Math.PI * t) : 1;
    return {
      a: mixColor(from.a, to.a, t),
      b: mixColor(from.b, to.b, t),
      grid: mixColor(from.grid, to.grid, t),
      glint: mixColor(from.glint, to.glint, t),
      shadow: mixColor(from.shadow, to.shadow, t),
      additive: t < 0.5 ? from.additive : to.additive,
      intensity: lerp(from.intensity, to.intensity, t) * dip,
    };
  }

  /* ---------- построение вуалей ---------- */

  build() {
    const o = this.opts;
    const rand = mulberry32(o.seed);
    const r = (a, b) => lerp(a, b, rand());
    this.strands = [];
    this.ribbons = [];

    for (const side of [-1, 1]) {
      for (let i = 0; i < o.ribbons; i++) {
        const y0 = lerp(0.1, 0.9, (i + 0.5) / o.ribbons) + r(-0.05, 0.05);
        const ribbon = {
          side,
          index: i,
          y0,
          yEnd: 0.5 + (y0 - 0.5) * r(0.12, 0.3),
          xEnd: r(0.0, 0.05), // насколько не доходит до центра (доля W)
          spread: r(0.04, 0.11),
          amp: r(0.04, 0.11),
          freq: r(0.7, 1.7),
          twist: r(0.6, 1.9),
          speed: r(0.1, 0.22),
          phase: r(0, TAU),
          mix: rand() < 0.5 ? r(0, 0.3) : r(0.65, 1),
          delay: Math.abs(i - (o.ribbons - 1) / 2) * 0.15 + r(0, 0.2),
          reveal: 0,
        };
        this.ribbons.push(ribbon);
        const n = o.strandsPerRibbon;
        for (let s = 0; s < n; s++) {
          const wisp = rand() < o.wisps;
          this.strands.push({
            ribbon,
            k: n > 1 ? s / (n - 1) - 0.5 : 0,
            mix: rand() < 0.25 ? 1 - ribbon.mix : ribbon.mix + r(-0.1, 0.1),
            jAmp: wisp ? r(0.04, 0.1) : r(0.003, 0.018),
            jFreq: wisp ? r(1.5, 3.5) : r(3, 8),
            phase: r(0, TAU),
            alpha: wisp ? r(0.4, 0.9) : r(0.2, 1),
            width: wisp ? r(0.5, 0.9) : r(0.4, 1.3),
            pts: new Float32Array(o.points * 2),
            color: null,
          });
        }
      }
    }

    this.rand = rand;
    this.glints = Array.from({ length: o.glints }, () => this.spawnGlint({}, true));
  }

  spawnGlint(g, initial = false) {
    const rand = this.rand;
    g.strand = (rand() * this.strands.length) | 0;
    g.t = initial ? rand() * 0.9 : rand() * 0.3;
    g.speed = lerp(0.02, 0.06, rand());
    g.size = rand() < 0.15 ? lerp(3, 5, rand()) : lerp(0.8, 2, rand());
    g.phase = rand() * TAU;
    return g;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.opts.maxDpr);
    this.W = this.canvas.clientWidth || innerWidth;
    this.H = this.canvas.clientHeight || innerHeight;
    this.dpr = dpr;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.W * dpr);
      c.height = Math.round(this.H * dpr);
    }
    this.bloomCanvas.width = Math.round(this.W / 4);
    this.bloomCanvas.height = Math.round(this.H / 4);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.draw(dt);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------- камера и мир ---------- */

  prepareCamera() {
    const px = this.opts.parallax ? this.pointer.x : 0;
    const py = this.opts.parallax ? this.pointer.y : 0;
    const yaw = 0.025 * Math.sin(this.time * 0.08) + px * 0.03;
    const pitch = py * 0.015;
    this.cam = { cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch), f: this.H * this.opts.fov };
  }

  /** Высота поверхности (пол: sign = -1, потолок: sign = 1) в точке (x, z). */
  surfaceY(x, z, sign = -1) {
    const { camHeight: h, curve } = this.opts;
    const t = this.time;
    // пол в центре ровный, волны — на стенах и потолке
    const wallMask = sign > 0 ? 1 : sstep(2.2, 4.5, Math.abs(x));
    const wave = 0.16 * wallMask * Math.sin(x * 0.9 + z * 0.35 + t * 0.3) * Math.cos(z * 0.42 - x * 0.3 - t * 0.22);
    return sign * (h - curve * x * x) + wave;
  }

  /** Мировая точка → экран. Возвращает [sx, sy, depth, screenRadius] или null. */
  project(x, y, z) {
    const { W, H, cam } = this;
    const xr = x * cam.cy - z * cam.sy;
    const zr = x * cam.sy + z * cam.cy;
    const yr = y * cam.cp - zr * cam.sp;
    const zd = y * cam.sp + zr * cam.cp;
    if (zd < 0.05) return null;
    const sx = W / 2 + (xr / zd) * cam.f;
    const sy = H / 2 - (yr / zd) * cam.f;
    return [sx, sy, zd, Math.hypot((sx - W / 2) / (W / 2), (sy - H / 2) / (H / 2)) / Math.SQRT2];
  }

  /* ---------- интро ---------- */

  gridReveal() {
    const { delay, grid } = this.opts.intro;
    return smooth(clamp((this.clock - delay) / grid, 0, 1)) * 1.3;
  }

  revealAlpha(r, p) {
    if (p >= 1.3) return 1;
    return clamp((p - r) / 0.16, 0, 1) + Math.exp(-(((p - r) / 0.045) ** 2)) * 1.8;
  }

  /* ---------- кадр ---------- */

  draw(dt) {
    const { ctx, W, H } = this;
    this.time += dt * this.opts.speed;
    this.clock += dt;

    if (this.transition) {
      this.transition.t += dt / 0.7;
      if (this.transition.t >= 1) this.transition = null;
    }
    const pal = this.currentPalette();

    const pk = 1 - Math.exp(-dt * 2);
    this.pointer.x += (this.pointer.tx - this.pointer.x) * pk;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * pk;
    this.prepareCamera();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    const p = this.gridReveal();
    this.drawTunnel(pal, p);
    this.drawShadows(pal, p);
    this.drawVeils(pal);
    this.drawGlints(pal, dt);
    this.updateObjects(p);
  }

  drawTunnel(pal, p) {
    if (p <= 0) return;
    const { ctx, opts } = this;
    const { tile, near, far, camHeight, curve } = opts;
    const xMax = Math.sqrt(camHeight / curve); // где пол встречается с потолком
    const LEVELS = 18, MAX = 2.8;
    const buckets = Array.from({ length: LEVELS }, () => []);

    const fogA = (z) => Math.pow(clamp(1 - (z - near) / (far - near), 0, 1), opts.fog);
    const add = (a, b) => {
      if (!a || !b) return;
      const al = ((this.revealAlpha(a[3], p) + this.revealAlpha(b[3], p)) / 2) * a[4];
      if (al <= 0.01) return;
      buckets[Math.min(LEVELS - 1, Math.round((al / MAX) * (LEVELS - 1)))].push(a[0], a[1], b[0], b[1]);
    };
    const pt = (x, z, sign, k) => {
      const q = this.project(x, this.surfaceY(x, z, sign), z);
      if (q) q.push(fogA(z) * k);
      return q;
    };

    // логарифмическая выборка по глубине — больше точек вблизи
    const ZS = 44;
    const zSamples = Array.from({ length: ZS + 1 }, (_, i) => near * Math.pow(far / near, i / ZS));
    const cols = Math.floor(xMax / tile);
    const XS = 36;

    for (const sign of [-1, 1]) {
      const k = sign < 0 ? 1 : opts.ceiling;
      // продольные линии (x = const)
      for (let c = -cols; c <= cols; c++) {
        const x = c * tile;
        let prev = pt(x, zSamples[0], sign, k);
        for (let i = 1; i <= ZS; i++) {
          const cur = pt(x, zSamples[i], sign, k);
          add(prev, cur);
          prev = cur;
        }
      }
      // поперечные линии (z = const)
      for (let z = near; z <= far; z += tile) {
        let prev = pt(-xMax, z, sign, k);
        for (let i = 1; i <= XS; i++) {
          const cur = pt(lerp(-xMax, xMax, i / XS), z, sign, k);
          add(prev, cur);
          prev = cur;
        }
      }
    }

    ctx.lineWidth = 0.9;
    for (let l = 0; l < LEVELS; l++) {
      const list = buckets[l];
      if (!list.length) continue;
      ctx.strokeStyle = rgba(pal.grid, opts.gridOpacity * (l / (LEVELS - 1)) * MAX);
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 4) {
        ctx.moveTo(list[k], list[k + 1]);
        ctx.lineTo(list[k + 2], list[k + 3]);
      }
      ctx.stroke();
    }
  }

  /* ---------- вуали ---------- */

  computeStrand(s) {
    const { W, H, time } = this;
    const rb = s.ribbon;
    const n = this.opts.points;
    const xOuter = rb.side < 0 ? -0.06 * W : 1.06 * W;
    const fx = W / 2 + rb.side * rb.xEnd * W;
    const fy = rb.yEnd * H;
    const pts = s.pts;
    const tt = time * rb.speed;

    for (let p = 0; p < n; p++) {
      const t = p / (n - 1);
      const e = Math.pow(1 - t, 1.1); // 1 у края, 0 в центре
      const x = lerp(xOuter, fx, t);
      const yc =
        lerp(rb.y0 * H, fy, smooth(t)) +
        rb.amp * H * e * Math.sin(t * rb.freq * Math.PI + tt * TAU * 0.35 + rb.phase);
      const fold = Math.cos(t * rb.twist * Math.PI + tt * 1.3 + rb.phase);
      const width = rb.spread * H * e + H * 0.02 * (1 - e);
      const y =
        yc + s.k * width * fold +
        s.jAmp * H * Math.sqrt(e) * Math.sin(t * s.jFreq * Math.PI + tt * 2.2 + s.phase);
      pts[p * 2] = x;
      pts[p * 2 + 1] = y;
    }
  }

  strandGradient(ctx, s, color, a) {
    const { W } = this;
    const rb = s.ribbon;
    const xOuter = rb.side < 0 ? -0.06 * W : 1.06 * W;
    const fx = W / 2 + rb.side * rb.xEnd * W;
    const grad = ctx.createLinearGradient(xOuter, 0, fx, 0);
    const STOPS = 12;
    for (let k = 0; k < STOPS; k++) {
      const t = k / (STOPS - 1);
      const prof = t < 0.14 ? t / 0.14 : t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      const d = 1 - t;
      const mask = rb.reveal >= 1.3 ? 1 : clamp((rb.reveal - d) / 0.22, 0, 1) + Math.exp(-(((rb.reveal - d) / 0.05) ** 2)) * 0.9;
      grad.addColorStop(t, rgba(color, a * prof * mask));
    }
    return grad;
  }

  drawVeils(pal) {
    const { lctx: c, opts, W, H } = this;
    const n = opts.points;
    const base = (pal.additive ? 0.42 : 0.34) * pal.intensity * opts.strandOpacity;
    const { veilsAt, veils } = opts.intro;

    let any = false;
    for (const rb of this.ribbons) {
      rb.reveal = smooth(clamp((this.clock - veilsAt - rb.delay) / veils, 0, 1)) * 1.3;
      if (rb.reveal > 0) any = true;
    }
    if (!any) return;

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    for (const s of this.strands) if (s.ribbon.reveal > 0) this.computeStrand(s);

    // «ткань» — полупрозрачная заливка между соседними нитями пучка
    const per = opts.strandsPerRibbon;
    for (let ri = 0; ri < this.ribbons.length; ri++) {
      const rb = this.ribbons[ri];
      if (rb.reveal <= 0 || per < 2) continue;
      const first = this.strands[ri * per];
      const last = this.strands[ri * per + per - 1];
      const color = mixColor(pal.a, pal.b, rb.mix);
      c.beginPath();
      c.moveTo(first.pts[0], first.pts[1]);
      for (let p = 1; p < n; p++) c.lineTo(first.pts[p * 2], first.pts[p * 2 + 1]);
      for (let p = n - 1; p >= 0; p--) c.lineTo(last.pts[p * 2], last.pts[p * 2 + 1]);
      c.closePath();
      c.fillStyle = this.strandGradient(c, first, color, pal.additive ? 0.09 : 0.06);
      c.fill();
    }

    // нити
    for (const s of this.strands) {
      if (s.ribbon.reveal <= 0) continue;
      s.color = mixColor(pal.a, pal.b, clamp(s.mix, 0, 1));
      c.beginPath();
      c.moveTo(s.pts[0], s.pts[1]);
      for (let p = 1; p < n; p++) c.lineTo(s.pts[p * 2], s.pts[p * 2 + 1]);
      c.lineWidth = s.width;
      c.strokeStyle = this.strandGradient(c, s, s.color, base * s.alpha);
      c.stroke();
    }

    // свечение: уменьшенная размытая копия слоя
    const b = this.bctx;
    const bw = this.bloomCanvas.width, bh = this.bloomCanvas.height;
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bw, bh);
    b.filter = 'blur(3px)';
    b.drawImage(this.layer, 0, 0, bw, bh);
    b.filter = 'none';

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    ctx.globalAlpha = opts.bloom * (pal.additive ? 1 : 0.55);
    ctx.drawImage(this.bloomCanvas, 0, 0, this.canvas.width, this.canvas.height);
    if (pal.additive) ctx.drawImage(this.bloomCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.layer, 0, 0);
    ctx.restore();
  }

  drawGlints(pal, dt) {
    const { ctx, opts } = this;
    const n = opts.points;
    ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';

    for (const g of this.glints) {
      g.t += g.speed * dt * opts.speed;
      if (g.t > 0.96) this.spawnGlint(g);
      const s = this.strands[g.strand];
      if (!s || s.ribbon.reveal < 1.1) continue;
      const fadeIn = clamp((s.ribbon.reveal - 1.1) / 0.2, 0, 1);
      const f = g.t * (n - 1);
      const i = Math.min(n - 2, f | 0);
      const fr = f - i;
      const x = lerp(s.pts[i * 2], s.pts[i * 2 + 2], fr);
      const y = lerp(s.pts[i * 2 + 1], s.pts[i * 2 + 3], fr);
      const life = Math.pow(Math.sin(Math.PI * clamp(g.t / 0.96, 0, 1)), 0.6);
      const tw = 0.6 + 0.4 * Math.sin(this.time * 3.2 + g.phase);
      const a = life * tw * pal.intensity * fadeIn;
      const r = g.size * 5;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(pal.glint, a));
      grad.addColorStop(0.12, rgba(pal.glint, a * 0.7));
      grad.addColorStop(0.35, rgba(pal.glint, a * 0.15));
      grad.addColorStop(1, rgba(pal.glint, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- объекты на полу ---------- */

  drawShadows(pal, p) {
    const { ctx } = this;
    for (const o of this.objects) {
      if (!o.shadow) continue;
      const q = this.project(o.x, this.surfaceY(o.x, o.z), o.z);
      if (!q) continue;
      const a = clamp((p - q[3] - 0.05) / 0.2, 0, 1);
      if (a <= 0) continue;
      const w = o.el.offsetWidth * ((o.height * this.cam.f) / q[2] / o.el.offsetHeight);
      const rx = w * 0.6;
      const ry = rx * (this.opts.camHeight / q[2]) * 0.9;
      ctx.save();
      ctx.translate(q[0], q[1]);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(pal.shadow, a));
      g.addColorStop(1, rgba(pal.shadow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  updateObjects(p) {
    for (const o of this.objects) {
      const { el } = o;
      const q = this.project(o.x, this.surfaceY(o.x, o.z), o.z);
      if (!q) {
        el.style.opacity = '0';
        continue;
      }
      const w = el.offsetWidth, h = el.offsetHeight;
      const s = (o.height * this.cam.f) / q[2] / h;
      el.style.transform = `translate(${q[0] - (w * s) / 2}px, ${q[1] - h * s}px) scale(${s})`;
      el.style.zIndex = String(1000 - Math.round(q[2] * 10));
      el.style.opacity = clamp((p - q[3] - 0.05) / 0.2, 0, 1).toFixed(3);
    }
  }
}
