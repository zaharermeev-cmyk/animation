/**
 * VeilBackground — анимированный фон по референсу:
 *  - волнистая сетка-ландшафт из ромбовидных плиток (вид сверху под углом),
 *    с провалом в центре и подсветкой складок;
 *  - вуали: мягкий дымчатый «шёлк», пучки волокон с огоньками на кончиках,
 *    свободные завитки и россыпь искр;
 *  - на поверхность можно ставить DOM-объекты (bg.place).
 *
 * Интро: пустой экран → от центра материализуется сетка → вырастают вуали.
 * Цвета — из CSS-переменных (--veil-*), фон подстраивается под тему.
 */

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);

export const DEFAULTS = {
  // вуали
  ribbons: 7, // пучков волокон с каждой стороны
  strandsPerRibbon: 22,
  smoke: 5, // дымчатых полос с каждой стороны
  loose: 28, // свободных завитков
  points: 64,
  glints: 70,
  bloom: 1,
  strandOpacity: 1,
  // сетка
  cell: 0.5, // размер плитки
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

export class VeilBackground {
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
    Object.assign(this.opts, options);
    this.build();
  }

  /**
   * Поставить DOM-элемент на поверхность сетки.
   *   { x, z }  — мировые координаты (x — вбок, z — вглубь, 0,0 — центр экрана)
   *   height    — высота объекта в мировых единицах (плитка = opts.cell)
   * Нижний центр элемента ставится в точку поверхности.
   */
  place(el, { x = 0, z = 0, height = 2, shadow = true } = {}) {
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
      a: parseColor(v('--veil-a'), [226, 190, 130, 1]),
      b: parseColor(v('--veil-b'), [170, 200, 245, 1]),
      smoke: parseColor(v('--veil-smoke'), [150, 180, 230, 1]),
      grid: parseColor(v('--veil-grid'), [215, 190, 145, 0.4]),
      glint: parseColor(v('--veil-glint'), [255, 240, 210, 1]),
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
    const out = { additive: t < 0.5 ? from.additive : to.additive, intensity: lerp(from.intensity, to.intensity, t) * dip };
    for (const k of ['a', 'b', 'smoke', 'grid', 'glint', 'shadow']) out[k] = mixColor(from[k], to[k], t);
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
        x0: side < 0 ? r(0.02, 0.35) : r(0.65, 0.98),
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
    g.t = initial ? rand() * 0.95 : rand() * 0.3;
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
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.W * dpr);
      c.height = Math.round(this.H * dpr);
    }
    this.bloomCanvas.width = Math.round(this.W / 4);
    this.bloomCanvas.height = Math.round(this.H / 4);
    this.smokeCanvas.width = Math.round(this.W / 4);
    this.smokeCanvas.height = Math.round(this.H / 4);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.draw(dt);
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
    this.drawGrid(pal, p);
    this.drawShadows(pal, p);
    this.drawSmoke(pal);
    this.drawFibers(pal);
    this.drawGlints(pal, dt);
    this.updateObjects(p);
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
    const xOuter = side < 0 ? -0.06 * W : 1.06 * W;
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
    const xOuter = side < 0 ? -0.06 * W : 1.06 * W;
    const fx = W / 2 + side * xEnd * W;
    const grad = ctx.createLinearGradient(xOuter, 0, fx, 0);
    const STOPS = 12;
    for (let k = 0; k < STOPS; k++) {
      const t = k / (STOPS - 1);
      const prof = t < fadeIn ? t / fadeIn : t < tEnd - 0.12 ? 1 : clamp((tEnd - t) / 0.12, 0, 1);
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
      c.fillStyle = this.gradientFor(c, s.side, s.xEnd, pal.smoke, s.alpha * (pal.additive ? 0.32 : 0.25) * pal.intensity, reveal, 1, 0.3);
      c.fill();
    }
    if (!any) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    ctx.filter = `blur(${Math.round(20 * this.dpr)}px)`;
    ctx.drawImage(this.smokeCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.filter = 'none';
    ctx.restore();
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

    let any = false;
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
      c.strokeStyle = this.gradientFor(c, rb.side, rb.xEnd, color, base * s.alpha, rb.reveal, s.tEnd);
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
    ctx.drawImage(this.bloomCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
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
  }

  /* ---------- объекты ---------- */

  drawShadows(pal, p) {
    const { ctx } = this;
    for (const o of this.objects) {
      if (!o.shadow) continue;
      const q = this.project(o.x, this.surfaceY(o.x, o.z), o.z);
      if (!q) continue;
      const a = clamp((p - q[3] - 0.05) / 0.2, 0, 1);
      if (a <= 0) continue;
      const s = (o.height * this.cam.F) / q[2] / o.el.offsetHeight;
      const rx = o.el.offsetWidth * s * 0.6;
      const ry = rx * 0.35;
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
      const s = (o.height * this.cam.F) / q[2] / h;
      el.style.transform = `translate(${q[0] - (w * s) / 2}px, ${q[1] - h * s}px) scale(${s})`;
      el.style.zIndex = String(1000 - Math.round(q[2] * 10));
      el.style.opacity = clamp((p - q[3] - 0.05) / 0.2, 0, 1).toFixed(3);
    }
  }
}
