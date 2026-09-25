/**
 * VeilBackground — анимированный фон: перспективная сетка-«тоннель» из плиток
 * + шёлковые вуали из тонких нитей, сходящиеся к центру, + искры на нитях.
 *
 * Интро: пустой экран → от центра материализуются плитки → затем вуали.
 * На плитки можно «прикрепить» любой DOM-элемент (bg.pin) — он будет
 * натянут на плитки в той же перспективе и появится вместе с ними.
 *
 * Цвета берутся из CSS-переменных (--veil-*), фон сам подстраивается
 * под светлую/тёмную тему.
 */

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const DEFAULTS = {
  ribbons: 5, // вуалей с каждой стороны
  strandsPerRibbon: 24, // нитей в одной вуали
  band: 0.25, // половина высоты полосы, в которой живут вуали (доля экрана)
  points: 72,
  glints: 16,
  gridCols: 40,
  gridRows: 26,
  depth: 1, // сила перспективы тоннеля
  gridOpacity: 1,
  strandOpacity: 1,
  speed: 1,
  glow: true,
  parallax: true,
  maxDpr: 1.5,
  seed: 7,
  intro: {
    delay: 0.5, // пустой экран, с
    grid: 2.6, // длительность проявления плиток
    veilsAt: 1.7, // когда начинают появляться вуали
    veils: 2.6,
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

/** Матрица CSS, натягивающая прямоугольник w×h на четырёхугольник (TL, TR, BR, BL). */
function quadToMatrix3d(w, h, q) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (sx * dy2 - dx2 * sy) / den;
  const hh = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${x0},${y0},0,1)`;
}

export class VeilBackground {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { ...DEFAULTS, ...options, intro: { ...DEFAULTS.intro, ...options.intro } };
    this.root = document.documentElement;

    this.time = 0; // время анимации (зависит от speed)
    this.clock = 0; // реальное время с начала интро
    this.running = false;
    this.raf = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.pins = [];

    this.reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
    this.schemeMq = matchMedia('(prefers-color-scheme: dark)');
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
    this.schemeMq.addEventListener('change', this.onTheme);
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

  /** Проиграть интро заново. */
  replay() {
    this.clock = 0;
  }

  /** Поменять параметры на лету. */
  configure(options) {
    const rebuild = ['ribbons', 'strandsPerRibbon', 'points', 'glints', 'seed', 'band'].some(
      (k) => k in options && options[k] !== this.opts[k]
    );
    Object.assign(this.opts, options);
    if (rebuild) this.build();
  }

  /**
   * Прикрепить элемент к плиткам сетки.
   * col/row — левая верхняя плитка (0..gridCols-1 / 0..gridRows-1),
   * cols/rows — сколько плиток занимает. Элемент получает position:fixed
   * и трансформацию, натягивающую его на эти плитки.
   */
  pin(el, { col, row, cols = 1, rows = 1 }) {
    Object.assign(el.style, { position: 'fixed', left: '0', top: '0', transformOrigin: '0 0', margin: '0', opacity: '0' });
    const pin = { el, col, row, cols, rows };
    this.pins.push(pin);
    return pin;
  }

  /**
   * Прикрепить элемент к плиткам, начиная с точки экрана (x, y) и шириной w
   * (всё в долях экрана 0..1). Высота подбирается по пропорциям элемента.
   */
  pinArea(el, x, y, w) {
    const a = this.tileAt(x * this.W, y * this.H);
    const b = this.tileAt((x + w) * this.W, y * this.H);
    const col = Math.min(a.col, b.col);
    const cols = Math.abs(b.col - a.col) + 1;
    // подбираем число рядов плиток так, чтобы пропорции блока сохранились
    const aspect = el.offsetHeight / el.offsetWidth;
    const top = a.row;
    const [x0, y0] = this.project(col, top);
    const [x1] = this.project(col + cols, top);
    let rows = 1;
    for (; rows < this.opts.gridRows - top; rows++) {
      const [, yb] = this.project(col, top + rows);
      if (Math.abs(yb - y0) / Math.abs(x1 - x0) >= aspect) break;
    }
    return this.pin(el, { col, row: top, cols, rows });
  }

  unpin(el) {
    this.pins = this.pins.filter((p) => p.el !== el);
  }

  /** Ближайший к точке экрана узел сетки — удобно, чтобы подобрать col/row. */
  tileAt(x, y) {
    const { gridCols: cols, gridRows: rows } = this.opts;
    let best = null, bd = Infinity;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [px, py] = this.project(i + 0.5, j + 0.5, 0);
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) (bd = d), (best = { col: i, row: j });
      }
    }
    return best;
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
    this.schemeMq.removeEventListener('change', this.onTheme);
    this.themeObserver.disconnect();
  }

  /* ---------- внутреннее ---------- */

  readPalette() {
    const cs = getComputedStyle(this.root);
    const v = (name) => cs.getPropertyValue(name);
    return {
      a: parseColor(v('--veil-a'), [230, 196, 143, 1]),
      b: parseColor(v('--veil-b'), [159, 184, 255, 1]),
      grid: parseColor(v('--veil-grid'), [150, 170, 215, 0.12]),
      glint: parseColor(v('--veil-glint'), [255, 244, 220, 1]),
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
      additive: t < 0.5 ? from.additive : to.additive,
      intensity: lerp(from.intensity, to.intensity, t) * dip,
    };
  }

  build() {
    const o = this.opts;
    const rand = mulberry32(o.seed);
    const r = (a, b) => lerp(a, b, rand());
    this.strands = [];
    this.ribbons = [];

    for (const side of [-1, 1]) {
      for (let i = 0; i < o.ribbons; i++) {
        const ribbon = {
          side,
          index: i,
          y0: 0.5 + lerp(-o.band, o.band, o.ribbons > 1 ? i / (o.ribbons - 1) : 0.5) + r(-0.03, 0.03),
          spread: r(0.06, 0.13),
          amp: r(0.035, 0.07),
          freq: r(0.8, 1.5),
          twist: r(0.8, 1.6),
          speed: r(0.12, 0.22),
          phase: r(0, TAU),
          mix: rand(),
          color: null,
          reveal: 0,
        };
        this.ribbons.push(ribbon);
        const n = o.strandsPerRibbon;
        for (let s = 0; s < n; s++) {
          this.strands.push({
            ribbon,
            k: n > 1 ? s / (n - 1) - 0.5 : 0,
            jitter: r(-1, 1),
            phase: r(0, TAU),
            alpha: r(0.3, 1),
            width: r(0.5, 1.15),
            pts: new Float32Array(o.points * 2),
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
    g.t = initial ? rand() * 0.9 : rand() * 0.25;
    g.speed = lerp(0.025, 0.07, rand());
    g.size = lerp(1.2, 2.8, rand());
    g.phase = rand() * TAU;
    return g;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.opts.maxDpr);
    this.W = this.canvas.clientWidth || innerWidth;
    this.H = this.canvas.clientHeight || innerHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.draw(dt);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------- геометрия тоннеля ---------- */

  prepareCamera() {
    const px = this.opts.parallax ? this.pointer.x : 0;
    const py = this.opts.parallax ? this.pointer.y : 0;
    const ay = 0.04 * Math.sin(this.time * 0.09) + px * 0.04;
    const ax = py * 0.03;
    this.cam = { cy: Math.cos(ay), sy: Math.sin(ay), cx: Math.cos(ax), sx: Math.sin(ax) };
  }

  /** Узел сетки (i, j — дробные) → точка экрана и «радиус» от центра (0..1). */
  project(i, j) {
    const { gridCols: cols, gridRows: rows, depth } = this.opts;
    const { W, H, time, cam } = this;
    const u = (i / cols) * 2 - 1;
    const v = (j / rows) * 2 - 1;
    const X = u * 2.3;
    const Y = v * 1.45;
    const Z =
      3.4 - depth * (1.5 * u * u + 1.2 * v * v) +
      0.06 * Math.sin(u * 3.1 + time * 0.35) * Math.cos(v * 2.3 - time * 0.27);
    const X1 = X * cam.cy + (Z - 2) * cam.sy;
    const Z1 = -X * cam.sy + (Z - 2) * cam.cy + 2;
    const Y1 = Y * cam.cx - (Z1 - 2) * cam.sx;
    const Z2 = Math.max(0.35, Y * cam.sx + (Z1 - 2) * cam.cx + 2);
    const scale = Math.max(W, H) * 0.62;
    const sx = W / 2 + (X1 / Z2) * scale, sy = H / 2 + (Y1 / Z2) * scale;
    // «радиус» в экранных координатах: 0 — центр экрана, 1 — угол
    return [sx, sy, Math.hypot((sx - W / 2) / (W / 2), (sy - H / 2) / (H / 2)) / Math.SQRT2];
  }

  /* ---------- интро ---------- */

  gridReveal() {
    const { delay, grid } = this.opts.intro;
    return smooth(clamp((this.clock - delay) / grid, 0, 1)) * 1.25;
  }

  /** Непрозрачность узла сетки с радиусом r (0 центр .. 1 угол) + вспышка на фронте. */
  gridAlpha(r, p) {
    if (p >= 1.25) return 1;
    const a = clamp((p - r) / 0.18, 0, 1);
    const flash = Math.exp(-(((p - r) / 0.05) ** 2)) * 1.6;
    return a + flash;
  }

  /* ---------- отрисовка ---------- */

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
    ctx.clearRect(0, 0, W, H);

    this.drawGrid(pal);
    this.drawStrands(pal);
    this.drawGlints(pal, dt);
    this.updatePins();
  }

  drawGrid(pal) {
    const { ctx, opts } = this;
    const cols = opts.gridCols, rows = opts.gridRows;
    const size = (cols + 1) * (rows + 1) * 3;
    if (!this.gridPts || this.gridPts.length !== size) this.gridPts = new Float32Array(size);
    const P = this.gridPts;
    const p = this.gridReveal();
    if (p <= 0) return;

    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const [x, y, r] = this.project(i, j);
        const idx = (j * (cols + 1) + i) * 3;
        P[idx] = x;
        P[idx + 1] = y;
        P[idx + 2] = this.gridAlpha(r, p);
      }
    }

    // сегменты группируем по уровням яркости, чтобы рисовать пачками
    const LEVELS = 16, MAX = 2.6;
    const buckets = Array.from({ length: LEVELS }, () => []);
    const seg = (a, b) => {
      const al = (P[a + 2] + P[b + 2]) / 2;
      if (al <= 0.01) return;
      buckets[Math.min(LEVELS - 1, Math.round((al / MAX) * (LEVELS - 1)))].push(a, b);
    };
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const a = (j * (cols + 1) + i) * 3;
        if (i < cols) seg(a, a + 3);
        if (j < rows) seg(a, a + (cols + 1) * 3);
      }
    }

    ctx.lineWidth = 0.8;
    for (let l = 0; l < LEVELS; l++) {
      const list = buckets[l];
      if (!list.length) continue;
      ctx.strokeStyle = rgba(pal.grid, opts.gridOpacity * ((l / (LEVELS - 1)) * MAX));
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        ctx.moveTo(P[list[k]], P[list[k] + 1]);
        ctx.lineTo(P[list[k + 1]], P[list[k + 1] + 1]);
      }
      ctx.stroke();
    }
  }

  computeStrand(s) {
    const { W, H, time } = this;
    const rb = s.ribbon;
    const n = this.opts.points;
    // вуали немного заходят за центр и сходятся в пучок, а не в точку
    const fx = W / 2 - rb.side * 0.03 * W;
    const fy = H / 2 + (rb.y0 - 0.5) * H * 0.22;
    const xOuter = rb.side < 0 ? -0.04 * W : 1.04 * W;
    const pts = s.pts;
    const tt = time * rb.speed;

    for (let p = 0; p < n; p++) {
      const t = p / (n - 1);
      const e = Math.pow(1 - t, 1.25);
      const x = lerp(xOuter, fx, t);
      const yc =
        lerp(rb.y0 * H, fy, smooth(t)) +
        rb.amp * H * e * Math.sin(t * rb.freq * Math.PI + tt * TAU * 0.35 + rb.phase);
      const fold = Math.cos(t * rb.twist * Math.PI + tt * 1.3 + rb.phase);
      const width = rb.spread * H * e + H * 0.035 * (1 - e);
      const y = yc + s.k * width * fold + s.jitter * 0.006 * H * e * Math.sin(t * 8 + tt * 3 + s.phase);
      pts[p * 2] = x;
      pts[p * 2 + 1] = y;
    }
  }

  drawStrands(pal) {
    const { ctx, opts, W } = this;
    const n = opts.points;
    const base = (pal.additive ? 0.5 : 0.42) * pal.intensity * opts.strandOpacity;
    const { veilsAt, veils } = opts.intro;

    for (const rb of this.ribbons) {
      rb.color = mixColor(pal.a, pal.b, rb.mix);
      // каждая вуаль вырастает из центра к краю, с небольшим сдвигом
      rb.reveal = smooth(clamp((this.clock - veilsAt - rb.index * 0.2) / veils, 0, 1)) * 1.3;
    }

    ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const STOPS = 14;
    const grads = new Map();
    for (const s of this.strands) {
      const rb = s.ribbon;
      if (rb.reveal <= 0) continue;
      this.computeStrand(s);
      const xOuter = rb.side < 0 ? -0.04 * W : 1.04 * W;
      const a = base * s.alpha;
      const grad = ctx.createLinearGradient(xOuter, 0, W / 2 - rb.side * 0.03 * W, 0);
      for (let k = 0; k < STOPS; k++) {
        const t = k / (STOPS - 1);
        const prof =
          t < 0.22 ? lerp(0, 0.55, t / 0.22)
          : t < 0.7 ? lerp(0.55, 1, (t - 0.22) / 0.48)
          : t < 0.93 ? lerp(1, 0.5, (t - 0.7) / 0.23)
          : lerp(0.5, 0, (t - 0.93) / 0.07);
        const d = 1 - t; // 0 — центр, 1 — край
        const mask = rb.reveal >= 1.3 ? 1 : clamp((rb.reveal - d) / 0.25, 0, 1) + Math.exp(-(((rb.reveal - d) / 0.06) ** 2)) * 0.8;
        grad.addColorStop(t, rgba(rb.color, a * prof * mask));
      }
      if (!grads.has(rb)) grads.set(rb, { grad: null, first: s, last: s });
      const gi = grads.get(rb);
      if (s.k === 0.5 || gi.grad === null) gi.grad = grad;
      gi.last = s;

      ctx.beginPath();
      const pts = s.pts;
      ctx.moveTo(pts[0], pts[1]);
      for (let p = 1; p < n; p++) ctx.lineTo(pts[p * 2], pts[p * 2 + 1]);

      if (opts.glow && pal.additive) {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = s.width * 6;
        ctx.strokeStyle = grad;
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = s.width;
      ctx.strokeStyle = grad;
      ctx.stroke();
    }
    this.sheets = grads;
    this.drawSheets(pal);
  }

  /** Полупрозрачная «ткань» между крайними нитями вуали. */
  drawSheets(pal) {
    if (!this.sheets) return;
    const { ctx } = this;
    const n = this.opts.points;
    ctx.save();
    ctx.globalAlpha = pal.additive ? 0.1 : 0.07;
    for (const { grad, first, last } of this.sheets.values()) {
      if (first === last) continue;
      ctx.beginPath();
      ctx.moveTo(first.pts[0], first.pts[1]);
      for (let p = 1; p < n; p++) ctx.lineTo(first.pts[p * 2], first.pts[p * 2 + 1]);
      for (let p = n - 1; p >= 0; p--) ctx.lineTo(last.pts[p * 2], last.pts[p * 2 + 1]);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  drawGlints(pal, dt) {
    const { ctx, opts } = this;
    const n = opts.points;
    const { veilsAt, veils } = opts.intro;
    const fadeIn = clamp((this.clock - veilsAt - veils * 0.7) / 1, 0, 1);
    if (fadeIn <= 0) return;
    ctx.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';

    for (const g of this.glints) {
      g.t += g.speed * dt * opts.speed;
      if (g.t > 0.96) this.spawnGlint(g);
      const s = this.strands[g.strand];
      if (!s) continue;
      const f = g.t * (n - 1);
      const i = Math.min(n - 2, f | 0);
      const fr = f - i;
      const x = lerp(s.pts[i * 2], s.pts[i * 2 + 2], fr);
      const y = lerp(s.pts[i * 2 + 1], s.pts[i * 2 + 3], fr);
      const life = Math.pow(Math.sin(Math.PI * clamp(g.t / 0.96, 0, 1)), 0.6);
      const tw = 0.65 + 0.35 * Math.sin(this.time * 3.2 + g.phase);
      const a = life * tw * pal.intensity * fadeIn;
      const r = g.size * 5;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(pal.glint, a));
      grad.addColorStop(0.15, rgba(pal.glint, a * 0.6));
      grad.addColorStop(1, rgba(pal.glint, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }

  updatePins() {
    if (!this.pins.length) return;
    const p = this.gridReveal();
    for (const pin of this.pins) {
      const { el, col, row, cols, rows } = pin;
      const tl = this.project(col, row);
      const tr = this.project(col + cols, row);
      const br = this.project(col + cols, row + rows);
      const bl = this.project(col, row + rows);
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.transform = quadToMatrix3d(w, h, [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]);
      // появляется, когда до плиток дошёл фронт проявления
      const r = Math.max(tl[2], tr[2], br[2], bl[2]);
      el.style.opacity = clamp((p - r - 0.05) / 0.2, 0, 1).toFixed(3);
    }
  }
}
