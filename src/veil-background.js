/**
 * VeilBackground — анимированный фон по референсу:
 *  - волнистая сетка-ландшафт из ромбовидных плиток (вид сверху под углом),
 *    с провалом в центре и подсветкой складок;
 *  - вуали: мягкий дымчатый «шёлк», пучки волокон с огоньками на кончиках,
 *    свободные завитки и россыпь искр;
 *
 * Интро: пустой экран → от центра материализуется сетка → вырастают вуали.
 * Цвета — из CSS-переменных (--veil-*), фон подстраивается под тему.
 */

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);

const DEFAULTS = {
  // вуали
  water: 5, // водяных лент с каждой стороны
  ribbons: 5, // пучков волокон с каждой стороны
  strandsPerRibbon: 9,
  smoke: 5, // дымчатых полос с каждой стороны
  loose: 18, // свободных завитков
  points: 64,
  glints: 70,
  reach: 0.86, // докуда тянутся вуали от центра (1 — до края экрана)
  veils: true, // показывать вуали
  bloom: 1,
  strandOpacity: 1,
  // сетка
  cell: 0.17, // размер плитки
  span: 44, // размер поля в мировых единицах
  hills: 0, // высота волн (0 — ровный пол)
  pit: 0, // глубина провала в центре (0 — без провала)
  angle: 45, // поворот плиток, градусы (45 — ромбы, 0 — прямо)
  fade: 1, // затухание пола вдали (0..1)
  gridOpacity: 1,
  camHeight: 5,
  camBack: 9,
  fov: 1.0,
  // общее
  speed: 1,
  parallax: true,
  maxDpr: 1.5,
  seed: 5,
  intro: {
    delay: 0.5,
    grid: 2.8,
    veilsAt: 1.8,
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

class VeilBackground {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { ...DEFAULTS, ...options, intro: { ...DEFAULTS.intro, ...options.intro } };
    this.root = document.documentElement;

    const mk = () => {
      const c = document.createElement('canvas');
      return [c, c.getContext('2d')];
    };
    [this.layer, this.lctx] = mk(); // волокна
    [this.bloomCanvas, this.bctx] = mk(); // свечение
    [this.smokeCanvas, this.sctx] = mk(); // дым (низкое разрешение)
    [this.floorCanvas, this.fctx] = mk(); // пол
    [this.waterCanvas, this.wctx] = mk(); // вода (половинное разрешение)
    [this.flashCanvas, this.flctx] = mk(); // вспышка фронта проявления

    this.time = 0;
    this.clock = 0;
    this.running = false;
    this.raf = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };

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

  /** Включить / выключить вуали (плавно). */
  setVeils(on) {
    this.opts.veils = !!on;
  }

  toggleVeils() {
    this.setVeils(!this.opts.veils);
    return this.opts.veils;
  }

  replay() {
    this.clock = 0;
  }

  configure(options) {
    Object.assign(this.opts, options);
    this.build();
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
      a: parseColor(v('--veil-a'), [226, 190, 130, 1]),
      b: parseColor(v('--veil-b'), [170, 200, 245, 1]),
      smoke: parseColor(v('--veil-smoke'), [150, 180, 230, 1]),
      water: parseColor(v('--veil-water'), [30, 60, 120, 0.35]),
      waterEdge: parseColor(v('--veil-water-edge'), [160, 200, 255, 1]),
      waterHi: parseColor(v('--veil-water-hi'), [235, 245, 255, 1]),
      grid: parseColor(v('--veil-grid'), [215, 190, 145, 0.4]),
      glint: parseColor(v('--veil-glint'), [255, 240, 210, 1]),
      ink: parseColor(v('--scene-ink'), [235, 238, 245, 1]),
      fill: parseColor(v('--scene-fill'), [3, 6, 12, 1]),
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
    const out = { additive: t < 0.5 ? from.additive : to.additive, intensity: lerp(from.intensity, to.intensity, t) * dip };
    for (const k of ['a', 'b', 'smoke', 'water', 'waterEdge', 'waterHi', 'grid', 'glint', 'ink', 'fill']) out[k] = mixColor(from[k], to[k], t);
    return out;
  }

  /* ---------- построение вуалей ---------- */

  build() {
    const o = this.opts;
    const rand = mulberry32(o.seed);
    const r = (a, b) => lerp(a, b, rand());
    this.strands = [];
    this.ribbons = [];
    this.smokes = [];
    this.waters = [];
    this.loose = [];

    for (const side of [-1, 1]) {
      // пучки волокон
      for (let i = 0; i < o.ribbons; i++) {
        const y0 = lerp(0.12, 0.92, (i + 0.5) / o.ribbons) + r(-0.06, 0.06);
        const ribbon = {
          side,
          y0,
          yEnd: 0.5 + (y0 - 0.5) * r(0.1, 0.35) + r(-0.03, 0.03),
          xEnd: r(0.02, 0.09),
          spread: r(0.03, 0.1),
          amp: r(0.05, 0.13),
          freq: r(0.7, 1.8),
          twist: r(0.5, 1.8),
          speed: r(0.1, 0.2),
          phase: r(0, TAU),
          mix: rand() < 0.6 ? r(0, 0.25) : r(0.7, 1), // чаще золото
          delay: Math.abs(i - (o.ribbons - 1) / 2) * 0.15 + r(0, 0.25),
          reveal: 0,
        };
        this.ribbons.push(ribbon);
        for (let s = 0; s < o.strandsPerRibbon; s++) {
          const wisp = rand() < 0.1;
          this.strands.push({
            ribbon,
            k: o.strandsPerRibbon > 1 ? s / (o.strandsPerRibbon - 1) - 0.5 : 0,
            mix: rand() < 0.3 ? 1 - ribbon.mix : clamp(ribbon.mix + r(-0.15, 0.15), 0, 1),
            jAmp: wisp ? r(0.04, 0.1) : r(0.004, 0.025),
            jFreq: wisp ? r(1.5, 3.5) : r(2.5, 7),
            phase: r(0, TAU),
            alpha: wisp ? r(0.4, 0.9) : r(0.15, 1),
            width: r(0.4, 1.2),
            tip: rand() < 0.35, // огонёк на кончике волокна
            tEnd: r(0.9, 1),
            pts: new Float32Array(o.points * 2),
          });
        }
      }
      // водяные ленты
      for (let i = 0; i < o.water; i++) {
        this.waters.push({
          side,
          y0: lerp(0.2, 0.82, (i + 0.5) / o.water) + r(-0.06, 0.06),
          yEnd: 0.5 + r(-0.07, 0.07),
          xEnd: r(0.02, 0.1),
          amp: r(0.05, 0.12),
          freq: r(0.7, 1.5),
          width: r(0.05, 0.1),
          twist: r(0.7, 1.6),
          speed: r(0.09, 0.17),
          phase: r(0, TAU),
          alpha: r(0.6, 1),
          delay: Math.abs(i - (o.water - 1) / 2) * 0.12 + r(0, 0.2),
          x: new Float32Array(48),
          yc: new Float32Array(48),
          hw: new Float32Array(48),
          reveal: 0,
        });
      }
      // дымчатые полосы
      for (let i = 0; i < o.smoke; i++) {
        this.smokes.push({
          side,
          y0: lerp(0.18, 0.85, (i + 0.5) / o.smoke) + r(-0.08, 0.08),
          yEnd: 0.5 + r(-0.08, 0.08),
          xEnd: r(0.05, 0.14),
          amp: r(0.06, 0.14),
          freq: r(0.8, 1.6),
          width: r(0.015, 0.045),
          speed: r(0.08, 0.16),
          phase: r(0, TAU),
          alpha: r(0.35, 0.8),
          delay: r(0, 0.5),
        });
      }
    }

    // свободные завитки — тонкие волокна, гуляющие поверх сетки
    for (let i = 0; i < o.loose; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      this.loose.push({
        side,
        x0: side < 0 ? r(0.14, 0.36) : r(0.64, 0.86),
        y0: r(0.05, 0.95),
        len: r(0.08, 0.22),
        angle: r(-0.6, 0.6) + (side < 0 ? 0 : Math.PI),
        curl: r(-5, 5),
        phase: r(0, TAU),
        alpha: r(0.15, 0.5),
        mix: rand(),
        delay: r(0.3, 1.2),
      });
    }

    this.rand = rand;
    this.glints = Array.from({ length: o.glints }, () => this.spawnGlint({}, true));
  }

  spawnGlint(g, initial = false) {
    const rand = this.rand;
    g.strand = (rand() * this.strands.length) | 0;
    g.t = initial ? lerp(0.25, 0.95, rand()) : lerp(0.25, 0.45, rand());
    g.speed = lerp(0.01, 0.045, rand());
    const big = rand() < 0.08;
    g.size = big ? lerp(3, 4.5, rand()) : lerp(0.6, 1.6, rand());
    g.bead = big && rand() < 0.5; // «стеклянная капля»
    g.phase = rand() * TAU;
    return g;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.opts.maxDpr);
    this.W = this.canvas.clientWidth || innerWidth;
    this.H = this.canvas.clientHeight || innerHeight;
    this.dpr = dpr;
    for (const c of [this.canvas, this.layer, this.floorCanvas, this.flashCanvas]) {
      c.width = Math.round(this.W * dpr);
      c.height = Math.round(this.H * dpr);
    }
    this.bloomCanvas.width = Math.round(this.W / 4);
    this.bloomCanvas.height = Math.round(this.H / 4);
    this.waterCanvas.width = Math.round(this.W / 2);
    this.waterCanvas.height = Math.round(this.H / 2);
    this.smokeCanvas.width = Math.round(this.W / 4);
    this.smokeCanvas.height = Math.round(this.H / 4);
  }

  frame(now) {
    // real — настоящее время (интро, вкл/выкл, смена темы идут с нормальной скоростью
    // даже при низком FPS); dt — сглаженный шаг для движения
    const real = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.draw(Math.min(0.05, real), real);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------- камера и поверхность ---------- */

  prepareCamera() {
    const { camHeight, camBack, parallax, fov } = this.opts;
    const px = parallax ? this.pointer.x : 0;
    const py = parallax ? this.pointer.y : 0;
    const eye = [
      px * 0.4,
      camHeight + py * 0.3,
      -camBack,
    ];
    // смотрим в центр поля
    let f = [-eye[0], -eye[1], -eye[2]];
    const fl = Math.hypot(...f);
    f = f.map((v) => v / fl);
    let r = [f[2], 0, -f[0]];
    const rl = Math.hypot(...r);
    r = r.map((v) => v / rl);
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    this.cam = { eye, f, r, u, F: this.H * fov };
  }

  /** Высота поверхности в точке (x, z). */
  surfaceY(x, z) {
    const { hills, pit } = this.opts;
    const t = this.time;
    const w =
      Math.sin(x * 0.42 + z * 0.18 + t * 0.25) * 0.55 +
      Math.sin(z * 0.55 - x * 0.2 - t * 0.2) * 0.35 +
      Math.sin((x + z) * 0.9 + t * 0.35) * 0.15;
    const hole = Math.exp(-(x * x) / 18 - (z * z) / 10);
    return w * hills - pit * hole;
  }

  /** Мировая точка → [sx, sy, depth, screenRadius] или null. */
  project(x, y, z) {
    const { cam, W, H } = this;
    const dx = x - cam.eye[0], dy = y - cam.eye[1], dz = z - cam.eye[2];
    const zc = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (zc < 0.1) return null;
    const xc = dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2];
    const yc = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
    const sx = W / 2 + (xc / zc) * cam.F;
    const sy = H / 2 - (yc / zc) * cam.F;
    return [sx, sy, zc, Math.hypot((sx - W / 2) / (W / 2), (sy - H / 2) / (H / 2)) / Math.SQRT2];
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

  veilReveal(delay) {
    const { veilsAt, veils } = this.opts.intro;
    return smooth(clamp((this.clock - veilsAt - delay) / veils, 0, 1)) * 1.3;
  }

  /* ---------- кадр ---------- */

  draw(dt, real = dt) {
    const { ctx, W, H } = this;
    this.time += dt * this.opts.speed;
    this.clock += real;

    if (this.transition) {
      this.transition.t += real / 0.7;
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
    if (this.opts.hills || this.opts.pit) this.drawGrid(pal, p);
    else this.drawFloor(pal, p);
    // плавное включение / выключение вуалей
    const target = this.opts.veils ? 1 : 0;
    if (this.veilVis === undefined) this.veilVis = target;
    this.veilVis += clamp(target - this.veilVis, -real / 0.5, real / 0.5);
    if (this.veilVis > 0) this.drawVeils(pal, dt);
    if (this.scene) this.scene.draw(pal, real);
  }

  drawVeils(pal, dt) {
    this.drawSmoke(pal);
    this.computeWater();
    this.drawWaterBody(pal);
    this.drawFibers(pal);
    this.drawGlints(pal, dt);
  }

  /** Мировая точка → координаты камеры [xc, yc, zc]. */
  toCam(x, y, z) {
    const { cam } = this;
    const dx = x - cam.eye[0], dy = y - cam.eye[1], dz = z - cam.eye[2];
    return [
      dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2],
      dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2],
      dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2],
    ];
  }

  /**
   * Ровный пол: каждая линия сетки — прямая, поэтому рисуем её одним отрезком,
   * а затухание вдали и проявление в интро накладываем масками.
   */
  drawFloor(pal, p) {
    if (p <= 0) return;
    const { opts, W, H, cam, dpr } = this;
    const { span, cell } = opts;
    const f = this.fctx;
    const intro = p < 1.3;

    // пол неподвижен: если камера, цвет и размер не менялись — берём готовый кадр
    const key = [cam.eye[0].toFixed(3), cam.eye[1].toFixed(3), rgba(pal.grid), W, H, span, cell, opts.angle, opts.fade, opts.gridOpacity].join('|');
    if (!intro && key === this.floorKey) {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.drawImage(this.floorCanvas, 0, 0);
      this.ctx.restore();
      return;
    }
    this.floorKey = intro ? null : key;
    const ang = (opts.angle * Math.PI) / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const zOff = span * 0.3;
    const L = span / 2;
    const NEAR = 0.3;
    const sx = (c) => W / 2 + (c[0] / c[2]) * cam.F;
    const sy = (c) => H / 2 - (c[1] / c[2]) * cam.F;

    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, H);
    f.beginPath();
    const n = Math.round(span / cell);
    for (const dir of [0, 1]) {
      for (let k = 0; k <= n; k++) {
        const u = -L + k * cell;
        const [a0, b0, a1, b1] = dir ? [u, -L, u, L] : [-L, u, L, u];
        let c0 = this.toCam(a0 * ca - b0 * sa, 0, a0 * sa + b0 * ca + zOff);
        let c1 = this.toCam(a1 * ca - b1 * sa, 0, a1 * sa + b1 * ca + zOff);
        if (c0[2] < NEAR && c1[2] < NEAR) continue;
        // отсекаем часть линии за камерой
        if (c0[2] < NEAR || c1[2] < NEAR) {
          const t = (NEAR - c0[2]) / (c1[2] - c0[2]);
          const cut = [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), NEAR];
          if (c0[2] < NEAR) c0 = cut;
          else c1 = cut;
        }
        f.moveTo(sx(c0), sy(c0));
        f.lineTo(sx(c1), sy(c1));
      }
    }
    f.lineWidth = 0.6;
    f.strokeStyle = rgba(pal.grid, opts.gridOpacity);
    f.stroke();

    // затухание вдали: вертикальный градиент по глубине
    const stops = [];
    for (let z = -12; z <= span; z += 0.5) {
      const c = this.toCam(cam.eye[0], 0, z);
      if (c[2] < NEAR) continue;
      const d = 1 - opts.fade * clamp((c[2] - 5) / 17, 0, 1);
      stops.push([clamp(sy(c) / H, 0, 1), d * d]);
    }
    stops.sort((a, b) => a[0] - b[0]);
    const g = f.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    for (const [o, a] of stops) g.addColorStop(o, `rgba(0,0,0,${a.toFixed(3)})`);
    f.globalCompositeOperation = 'destination-in';
    f.fillStyle = g;
    f.fillRect(0, 0, W, H);

    const ctx = this.ctx;
    if (intro) {
      // «эллиптические» координаты: r = 0 в центре, r = 1 в углу экрана
      const ellipse = (c) =>
        c.setTransform((dpr * W) / 2 * Math.SQRT2, 0, 0, (dpr * H) / 2 * Math.SQRT2, (dpr * W) / 2, (dpr * H) / 2);
      const R = 1.5, STEPS = 60;
      const disc = f.createRadialGradient(0, 0, 0, 0, 0, R);
      const ring = f.createRadialGradient(0, 0, 0, 0, 0, R);
      for (let i = 0; i <= STEPS; i++) {
        const r = (i / STEPS) * R;
        disc.addColorStop(i / STEPS, `rgba(0,0,0,${clamp((p - r) / 0.16, 0, 1).toFixed(3)})`);
        ring.addColorStop(i / STEPS, `rgba(0,0,0,${clamp(Math.exp(-(((p - r) / 0.045) ** 2)), 0, 1).toFixed(3)})`);
      }
      const fl = this.flctx;
      fl.setTransform(1, 0, 0, 1, 0, 0);
      fl.globalCompositeOperation = 'source-over';
      fl.clearRect(0, 0, this.flashCanvas.width, this.flashCanvas.height);
      fl.drawImage(this.floorCanvas, 0, 0);
      fl.globalCompositeOperation = 'destination-in';
      ellipse(fl);
      fl.fillStyle = ring;
      fl.fillRect(-5, -5, 10, 10);

      ellipse(f);
      f.fillStyle = disc;
      f.fillRect(-5, -5, 10, 10);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.floorCanvas, 0, 0);
    if (intro) {
      ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
      ctx.drawImage(this.flashCanvas, 0, 0);
      ctx.globalAlpha = 0.8;
      ctx.drawImage(this.flashCanvas, 0, 0);
    }
    ctx.restore();
  }

  drawGrid(pal, p) {
    if (p <= 0) return;
    const { ctx, opts, W, H } = this;
    const { cell, span } = opts;
    // ромбы: сетка повёрнута на 45°
    const N = Math.round((span * Math.SQRT2) / cell);
    const size = (N + 1) * (N + 1) * 4;
    if (!this.gridPts || this.gridPts.length !== size) this.gridPts = new Float32Array(size);
    const P = this.gridPts;
    const ca = Math.cos((opts.angle * Math.PI) / 180), sa = Math.sin((opts.angle * Math.PI) / 180);
    const e = 0.05;
    const light = [-0.4, 0.8, -0.45];

    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const a = (i / N - 0.5) * span * Math.SQRT2;
        const b = (j / N - 0.5) * span * Math.SQRT2;
        const x = a * ca - b * sa;
        const z = a * sa + b * ca + span * 0.3;
        const y = this.surfaceY(x, z);
        const q = this.project(x, y, z);
        const idx = (j * (N + 1) + i) * 4;
        if (!q || q[0] < -200 || q[0] > W + 200 || q[1] < -200 || q[1] > H + 200) {
          P[idx + 3] = -1;
          continue;
        }
        // подсветка складок: нормаль через разности высот
        const nx = this.surfaceY(x - e, z) - this.surfaceY(x + e, z);
        const nz = this.surfaceY(x, z - e) - this.surfaceY(x, z + e);
        const ny = 2 * e;
        const nl = Math.hypot(nx, ny, nz);
        const lit = (nx * light[0] + ny * light[1] + nz * light[2]) / nl;
        const shade = opts.hills || opts.pit ? 0.35 + 0.9 * clamp(lit, 0, 1) ** 3 : 1;
        // виньетка к краям экрана
        const vig = 1 - 0.35 * clamp(q[3] * 1.2 - 0.3, 0, 1);
        // пол растворяется вдали
        const dist = 1 - opts.fade * clamp((q[2] - 5) / 17, 0, 1);
        P[idx] = q[0];
        P[idx + 1] = q[1];
        P[idx + 2] = this.revealAlpha(q[3], p);
        P[idx + 3] = shade * vig * dist * dist;
      }
    }

    const LEVELS = 20, MAX = 2.6;
    const buckets = Array.from({ length: LEVELS }, () => []);
    const seg = (a, b) => {
      if (P[a + 3] < 0 || P[b + 3] < 0) return;
      const al = ((P[a + 2] + P[b + 2]) / 2) * ((P[a + 3] + P[b + 3]) / 2);
      if (al <= 0.01) return;
      buckets[Math.min(LEVELS - 1, Math.round((al / MAX) * (LEVELS - 1)))].push(a, b);
    };
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const a = (j * (N + 1) + i) * 4;
        if (i < N) seg(a, a + 4);
        if (j < N) seg(a, a + (N + 1) * 4);
      }
    }

    ctx.lineWidth = 0.9;
    for (let l = 0; l < LEVELS; l++) {
      const list = buckets[l];
      if (!list.length) continue;
      ctx.strokeStyle = rgba(pal.grid, opts.gridOpacity * (l / (LEVELS - 1)) * MAX);
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        ctx.moveTo(P[list[k]], P[list[k] + 1]);
        ctx.lineTo(P[list[k + 1]], P[list[k + 1] + 1]);
      }
      ctx.stroke();
    }
  }

  /* ---------- вуали ---------- */

  /** Общая форма потока от края экрана к центру. */
  flow(side, t, y0, yEnd, xEnd, amp, freq, speed, phase) {
    const { W, H } = this;
    const xOuter = W / 2 + side * this.opts.reach * (W / 2);
    const fx = W / 2 + side * xEnd * W;
    const e = Math.pow(1 - t, 1.1);
    const tt = this.time * speed;
    const x = lerp(xOuter, fx, t);
    const y = lerp(y0 * H, yEnd * H, smooth(t)) + amp * H * e * Math.sin(t * freq * Math.PI + tt * TAU * 0.35 + phase);
    return [x, y, e, tt];
  }

  maskAt(reveal, t) {
    if (reveal >= 1.3) return 1;
    const d = 1 - t;
    return clamp((reveal - d) / 0.22, 0, 1) + Math.exp(-(((reveal - d) / 0.05) ** 2)) * 0.9;
  }

  gradientFor(ctx, side, xEnd, color, a, reveal, tEnd = 1, fadeIn = 0.14) {
    const { W } = this;
    const xOuter = W / 2 + side * this.opts.reach * (W / 2);
    const fx = W / 2 + side * xEnd * W;
    const grad = ctx.createLinearGradient(xOuter, 0, fx, 0);
    const STOPS = 12;
    for (let k = 0; k < STOPS; k++) {
      const t = k / (STOPS - 1);
      const prof = t < fadeIn ? smooth(t / fadeIn) : t < tEnd - 0.12 ? 1 : clamp((tEnd - t) / 0.12, 0, 1);
      grad.addColorStop(t, rgba(color, a * prof * this.maskAt(reveal, t)));
    }
    return grad;
  }

  drawSmoke(pal) {
    const { sctx: c, opts } = this;
    const sw = this.smokeCanvas.width, sh = this.smokeCanvas.height;
    const k = sw / this.W;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, sw, sh);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    let any = false;
    const n = 40;

    for (const s of this.smokes) {
      const reveal = this.veilReveal(s.delay);
      if (reveal <= 0) continue;
      any = true;
      const top = [], bot = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const [x, y, e, tt] = this.flow(s.side, t, s.y0, s.yEnd, s.xEnd, s.amp, s.freq, s.speed, s.phase);
        const w = this.H * s.width * (0.4 + e) * (0.45 + 0.55 * Math.abs(Math.sin(t * 4.5 + tt * 2 + s.phase)));
        top.push(x, y - w);
        bot.push(x, y + w);
      }
      c.beginPath();
      c.moveTo(top[0], top[1]);
      for (let i = 2; i < top.length; i += 2) c.lineTo(top[i], top[i + 1]);
      for (let i = bot.length - 2; i >= 0; i -= 2) c.lineTo(bot[i], bot[i + 1]);
      c.closePath();
      c.fillStyle = this.gradientFor(c, s.side, s.xEnd, pal.smoke, s.alpha * (pal.additive ? 0.32 : 0.25) * pal.intensity, reveal, 1, 0.42);
      c.fill();
    }
    if (!any) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    ctx.filter = `blur(${Math.round(20 * this.dpr)}px)`;
    ctx.globalAlpha = this.veilVis;
    ctx.drawImage(this.smokeCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.filter = 'none';
    ctx.restore();
  }

  /* ---------- водяные ленты ---------- */

  computeWater() {
    const { H } = this;
    for (const w of this.waters) {
      w.reveal = this.veilReveal(w.delay);
      if (w.reveal <= 0) continue;
      const n = w.x.length;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const [x, yc, e, tt] = this.flow(w.side, t, w.y0, w.yEnd, w.xEnd, w.amp, w.freq, w.speed, w.phase);
        // лента перекручивается: знак fold меняет местами верхний и нижний край
        const fold = Math.cos(t * w.twist * Math.PI + tt * 1.1 + w.phase);
        const half = H * w.width * (0.2 + 0.9 * e) * (0.75 + 0.25 * Math.sin(t * 5 + tt * 1.7 + w.phase));
        w.x[i] = x;
        w.yc[i] = yc;
        w.hw[i] = half * (Math.abs(fold) < 0.08 ? Math.sign(fold || 1) * 0.08 : fold);
      }
    }
  }

  /** Градиент вдоль ленты: форма, проявление и яркость там, где лента повёрнута ребром. */
  waterGradient(c, w, color, a, edgeBoost = 0) {
    const { W } = this;
    const xOuter = W / 2 + w.side * this.opts.reach * (W / 2);
    const fx = W / 2 + w.side * w.xEnd * W;
    const g = c.createLinearGradient(xOuter, 0, fx, 0);
    const n = w.x.length, STOPS = 16, H = this.H;
    for (let k = 0; k < STOPS; k++) {
      const t = k / (STOPS - 1);
      const i = Math.round(t * (n - 1));
      const prof = t < 0.38 ? smooth(t / 0.38) : t < 0.86 ? 1 : (1 - t) / 0.14;
      const flat = Math.abs(w.hw[i]) / (H * w.width + 1e-6); // 0 — ребром, 1 — плашмя
      const boost = 1 + edgeBoost * Math.pow(1 - clamp(flat, 0, 1), 3);
      g.addColorStop(t, rgba(color, a * prof * boost * this.maskAt(w.reveal, t)));
    }
    return g;
  }

  /** Полоса ленты между долями ширины k0..k1 (-0.5 — один край, 0.5 — другой). */
  bandPath(c, w, k0, k1) {
    const n = w.x.length;
    c.beginPath();
    c.moveTo(w.x[0], w.yc[0] + k0 * 2 * w.hw[0]);
    for (let i = 1; i < n; i++) c.lineTo(w.x[i], w.yc[i] + k0 * 2 * w.hw[i]);
    for (let i = n - 1; i >= 0; i--) c.lineTo(w.x[i], w.yc[i] + k1 * 2 * w.hw[i]);
    c.closePath();
  }

  edgePath(c, w, k, wobble = 0) {
    const n = w.x.length;
    const tt = this.time;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const off = wobble * Math.sin(i * 0.35 + tt * 1.3 + w.phase * 3 + k * 7) * Math.abs(w.hw[i]) * 0.3;
      const y = w.yc[i] + k * 2 * w.hw[i] + off;
      i ? c.lineTo(w.x[i], y) : c.moveTo(w.x[i], y);
    }
  }

  /** Толща воды: полупрозрачное тело ленты, слегка тонирующее сетку под ней. */
  drawWaterBody(pal) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = `blur(${Math.round(5 * this.dpr)}px)`;
    ctx.globalAlpha = this.veilVis;
    for (const w of this.waters) {
      if (w.reveal <= 0) continue;
      this.bandPath(ctx, w, -0.5, 0.5);
      ctx.fillStyle = this.waterGradient(ctx, w, pal.water, w.alpha * pal.intensity);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Свет в воде: края ярче середины, блики по краям и внутри ленты. */
  drawWaterLight(c, pal) {
    const BANDS = 10;
    const wc = this.wctx;
    const k = this.waterCanvas.width / this.W;
    wc.setTransform(1, 0, 0, 1, 0, 0);
    wc.globalCompositeOperation = 'source-over';
    wc.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);
    wc.setTransform(k, 0, 0, k, 0, 0);
    wc.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    // объём: полосы по ширине, у краёв ярче (как свет в толще воды)
    for (const w of this.waters) {
      if (w.reveal <= 0) continue;
      const a = w.alpha * pal.intensity * (pal.additive ? 1 : 0.8);
      for (let b = 0; b < BANDS; b++) {
        const k0 = b / BANDS - 0.5, k1 = (b + 1) / BANDS - 0.5;
        const m = Math.abs(k0 + k1);
        const fres = 0.06 + 0.32 * Math.pow(m, 2.2);
        this.bandPath(wc, w, k0, k1);
        wc.fillStyle = this.waterGradient(wc, w, pal.waterEdge, a * fres, 1.5);
        wc.fill();
      }
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.filter = `blur(${Math.round(4 * this.dpr)}px)`;
    c.drawImage(this.waterCanvas, 0, 0, this.layer.width, this.layer.height);
    c.filter = 'none';
    c.restore();

    for (const w of this.waters) {
      if (w.reveal <= 0) continue;
      const a = w.alpha * pal.intensity * (pal.additive ? 1 : 0.8);
      // блики по краям
      c.lineWidth = 1.1;
      for (const k of [-0.5, 0.5]) {
        this.edgePath(c, w, k);
        c.strokeStyle = this.waterGradient(c, w, pal.waterHi, a * 0.32, 1.2);
        c.stroke();
      }
      // внутренние блики, как отражения на воде
      c.lineWidth = 0.7;
      for (const k of [-0.28, 0.06, 0.3]) {
        this.edgePath(c, w, k, 1);
        c.strokeStyle = this.waterGradient(c, w, pal.waterHi, a * 0.14, 2);
        c.stroke();
      }
    }
  }

  computeStrand(s) {
    const { H } = this;
    const rb = s.ribbon;
    const n = this.opts.points;
    const pts = s.pts;
    for (let p = 0; p < n; p++) {
      const t = (p / (n - 1)) * s.tEnd;
      const [x, yc, e, tt] = this.flow(rb.side, t, rb.y0, rb.yEnd, rb.xEnd, rb.amp, rb.freq, rb.speed, rb.phase);
      const fold = Math.cos(t * rb.twist * Math.PI + tt * 1.3 + rb.phase);
      const width = rb.spread * H * e + H * 0.015 * (1 - e);
      pts[p * 2] = x;
      pts[p * 2 + 1] =
        yc + s.k * width * fold + s.jAmp * H * Math.sqrt(e) * Math.sin(t * s.jFreq * Math.PI + tt * 2.2 + s.phase);
    }
  }

  drawFibers(pal) {
    const { lctx: c, opts, W, H } = this;
    const n = opts.points;
    const base = (pal.additive ? 0.45 : 0.36) * pal.intensity * opts.strandOpacity;

    let any = this.waters.some((w) => w.reveal > 0);
    for (const rb of this.ribbons) {
      rb.reveal = this.veilReveal(rb.delay);
      if (rb.reveal > 0) any = true;
    }
    if (!any) return;

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    this.drawWaterLight(c, pal);

    // пучки волокон
    for (const s of this.strands) {
      const rb = s.ribbon;
      if (rb.reveal <= 0) continue;
      this.computeStrand(s);
      const color = mixColor(pal.a, pal.b, s.mix);
      c.beginPath();
      c.moveTo(s.pts[0], s.pts[1]);
      for (let p = 1; p < n; p++) c.lineTo(s.pts[p * 2], s.pts[p * 2 + 1]);
      c.lineWidth = s.width;
      c.strokeStyle = this.gradientFor(c, rb.side, rb.xEnd, color, base * s.alpha, rb.reveal, s.tEnd, 0.32);
      c.stroke();
    }

    // свободные завитки
    for (const l of this.loose) {
      const rv = this.veilReveal(l.delay);
      if (rv <= 0) continue;
      const a = l.alpha * base * clamp(rv / 1.3, 0, 1);
      const color = mixColor(pal.a, pal.b, l.mix);
      const len = l.len * W;
      let x = l.x0 * W, y = l.y0 * H, ang = l.angle + 0.3 * Math.sin(this.time * 0.3 + l.phase);
      c.beginPath();
      c.moveTo(x, y);
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        ang += (l.curl * (t * t) * 0.9) / steps + 0.04 * Math.sin(t * 6 + this.time * 0.5 + l.phase);
        x += (Math.cos(ang) * len) / steps;
        y += (Math.sin(ang) * len) / steps;
        c.lineTo(x, y);
      }
      c.lineWidth = 0.6;
      c.strokeStyle = rgba(color, a);
      c.stroke();
    }

    // свечение
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
    ctx.globalAlpha = opts.bloom * (pal.additive ? 0.9 : 0.45);
    ctx.globalAlpha *= this.veilVis;
    ctx.drawImage(this.bloomCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalAlpha = this.veilVis;
    ctx.drawImage(this.layer, 0, 0);
    ctx.restore();
  }

  drawDot(x, y, r, color, a, bead = false) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.12, rgba(color, a * 0.75));
    g.addColorStop(0.35, rgba(color, a * 0.15));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 5, 0, TAU);
    ctx.fill();
    if (bead) {
      // стеклянная капля: кольцо + блик
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(color, a * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = rgba(color, a * 0.9);
      ctx.beginPath();
      ctx.arc(x - r * 0.8, y - r * 0.8, r * 0.6, 0, TAU);
      ctx.fill();
    }
  }

  drawGlints(pal, dt) {
    const { opts } = this;
    this.ctx.save();
    this.ctx.globalAlpha = this.veilVis;
    const n = opts.points;
    this.ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    const glintB = mixColor(pal.glint, pal.b, 0.5);

    // огоньки на кончиках волокон (как у оптоволокна)
    for (const s of this.strands) {
      if (!s.tip || s.ribbon.reveal < 1) continue;
      const a = clamp((s.ribbon.reveal - 1) / 0.3, 0, 1) * (0.5 + 0.5 * Math.sin(this.time * 2 + s.phase)) * s.alpha;
      this.drawDot(s.pts[(n - 1) * 2], s.pts[(n - 1) * 2 + 1], 0.9, pal.glint, a * pal.intensity);
    }

    // искры, бегущие по волокнам
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
      const tw = 0.55 + 0.45 * Math.sin(this.time * 3.2 + g.phase);
      this.drawDot(x, y, g.size, g.bead ? glintB : pal.glint, life * tw * pal.intensity * fadeIn, g.bead);
    }
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.restore();
  }
}

// доступно как обычный <script>: window.VeilBackground
VeilBackground.VERSION = '10 — сцена: шахтёр и лиса';
window.VeilBackground = VeilBackground;
window.VEIL_DEFAULTS = DEFAULTS;
