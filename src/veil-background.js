/**
 * VeilBackground — анимированный фон: ровный 3D-пол из ромбовидных плиток,
 * уходящий в темноту. Интро: пустой экран → от центра материализуются плитки.
 * На пол можно подключить сцену (bg.scene = new MinerScene(bg)).
 * Цвета — из CSS-переменных, фон подстраивается под светлую/тёмную тему.
 */

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);

const DEFAULTS = {
  // пол
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
  intro: {
    delay: 1.4, // до начала проявления плиток (с логотипом — момент его разрыва)
    grid: 3.8, // проявление плиток
  },
  // после окончания сцены плитки пропадают и всё начинается заново
  loop: true,
  outro: {
    duration: 3.4, // исчезновение плиток (с логотипом — сборка лисы обратно)
    pause: 0.8, // пауза перед повтором
  },
};

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
    [this.floorCanvas, this.fctx] = mk(); // пол
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

    this.resize();
    this.prepareCamera();

    this.onResize = () => this.resize();
    this.onVisibility = () => (document.hidden ? this.pause() : this.resume());
    this.onPointer = (e) => {
      this.pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.ty = (e.clientY / innerHeight) * 2 - 1;
      // координаты курсора в пикселях канваса (для «фонарика»)
      const r = this.canvas.getBoundingClientRect();
      this.pointer.px = e.clientX - r.left;
      this.pointer.py = e.clientY - r.top;
      this.pointer.active = true;
    };
    this.onPointerOut = (e) => {
      if (!e.relatedTarget) this.pointer.active = false;
    };
    this.onTheme = () => requestAnimationFrame(() => this.refreshTheme());

    addEventListener('resize', this.onResize);
    addEventListener('pointermove', this.onPointer, { passive: true });
    // курсор мог уже стоять над страницей — ловим его при первом же наведении/клике
    document.addEventListener('pointerover', this.onPointer, { passive: true });
    document.addEventListener('pointerdown', this.onPointer, { passive: true });
    document.addEventListener('pointerout', this.onPointerOut);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.themeObserver = new MutationObserver(this.onTheme);
    this.themeObserver.observe(this.root, { attributes: true, attributeFilter: ['data-theme', 'data-plain', 'class', 'style'] });
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

  /** Перезапустить только сцену (плитки остаются проявленными). */
  restartScene() {
    if (!this.scene) return this.replay();
    this.clock = Math.max(this.scene.start, this.opts.intro.delay + this.opts.intro.grid) + 0.01;
    this.scene.reset();
  }

  configure(options) {
    Object.assign(this.opts, options);
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
    document.removeEventListener('pointerover', this.onPointer);
    document.removeEventListener('pointerdown', this.onPointer);
    document.removeEventListener('pointerout', this.onPointerOut);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.themeObserver.disconnect();
  }

  /* ---------- тема ---------- */

  readPalette() {
    const cs = getComputedStyle(this.root);
    const v = (name) => cs.getPropertyValue(name);
    return {
      grid: parseColor(v('--veil-grid'), [215, 190, 145, 0.4]),
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
    for (const k of ['grid', 'ink', 'fill']) out[k] = mixColor(from[k], to[k], t);
    return out;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.opts.maxDpr);
    this.W = this.canvas.clientWidth || innerWidth;
    this.H = this.canvas.clientHeight || innerHeight;
    this.dpr = dpr;
    for (const c of [this.canvas, this.floorCanvas, this.flashCanvas]) {
      c.width = Math.round(this.W * dpr);
      c.height = Math.round(this.H * dpr);
    }
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
    // с логотипом плитки проявляются из осколков: здесь только флаг «интро идёт / готово»
    if (this.burst && this.burst.ready) return this.vt >= this.burst.revealEnd ? 1.3 : 1;
    const { delay, grid } = this.opts.intro;
    const p = smooth(clamp((this.clock - delay) / grid, 0, 1)) * 1.3;
    // финал: плитки пропадают от краёв к центру (интро наоборот)
    return this.outro > 0 ? 1.3 * (1 - smooth(this.outro)) : p;
  }

  /** Прогресс финала 0..1 и перезапуск всего цикла. */
  updateLoop() {
    this.outro = 0;
    const sc = this.scene;
    if (!this.opts.loop || !sc || !sc.enabled) return;
    const { duration, pause } = this.opts.outro;
    const end = sc.endTime();
    if (this.clock > end + duration + pause) {
      // лиса уже собрана — продолжаем с неё, без пустого экрана
      this.clock = this.burst && this.burst.ready ? this.burst.restAt : 0;
      return;
    }
    this.outro = clamp((this.clock - end) / duration, 0, 1);
  }

  revealAlpha(r, p) {
    if (p >= 1.3) return 1;
    return clamp((p - r) / 0.16, 0, 1) + Math.exp(-(((p - r) / 0.045) ** 2)) * 1.8;
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

    this.updateLoop();
    this.vt = this.burst ? this.burst.virtualTime() : this.clock;
    const p = this.gridReveal();
    if (this.opts.hills || this.opts.pit) this.drawGrid(pal, p);
    else this.drawFloor(pal, p);
    if (this.burst) {
      this.burst.draw(pal, this.vt);
      // логотип в окне входа рисует сам burst: целым — до разрыва и после сборки, между ними его нет
      const on = this.burst.ready ? '1' : '';
      if (this.root.dataset.burst !== on) this.root.dataset.burst = on;
    }
    if (this.scene) this.scene.draw(pal, real);
    if (this.scene && this.scene.drawFlashlight) this.scene.drawFlashlight(pal);
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
    const burstMask = intro && this.burst && this.burst.ready;
    if (burstMask) this.burst.maskFloor(f, this.vt);
    else if (intro) {
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
    if (intro && !burstMask) {
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
}

// доступно как обычный <script>: window.VeilBackground
VeilBackground.VERSION = '25 — тумблер сплошного фона';
window.VeilBackground = VeilBackground;
window.VEIL_DEFAULTS = DEFAULTS;
