/**
 * MinerScene — сцена на полу: шахтёр долбит киркой землю возле своей кучки монет,
 * прибегает лиса, ворует монеты и убегает в бездну.
 * Всё рисуется линиями одного цвета (--scene-ink) с заливкой цветом фона (--scene-fill),
 * поэтому сцена сама подстраивается под светлую и тёмную тему.
 *
 * Дополнительные эффекты включаются тумблерами (scene.fx[ключ] = true):
 *   paws       — светящиеся следы лап
 *   schema     — «схема» на плитках: узлы и связи          (всегда включено)
 *   guard      — спящий охранник, лиса крадётся мимо        (всегда включено)
 *   flashlight — курсор-фонарик: наведи на лису — убежит     (всегда включено)
 *   Дополнения к схеме (по умолчанию выключены):
 *   sIcons, sPulses, sWave, sBuild, sLabels, sCounters, sShadow, sCross, sRadar, sFoxPath, sMiner
 *
 * Подключение:
 *   const bg = new VeilBackground(canvas);
 *   bg.scene = new MinerScene(bg, { fx: { paws: true } });
 */
(function () {
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const ease = (t) => smooth(clamp(t, 0, 1));
  const rad = (d) => (d * Math.PI) / 180;

  // [ключ, подпись, { hidden: всегда включено и не показывается в панели, group }]
  const FX = [
    ['paws', 'Следы лап'],
    ['schema', 'Схема на плитках', { hidden: true }],
    ['guard', 'Спящий охранник', { hidden: true }],
    ['flashlight', 'Курсор-фонарик', { hidden: true }],
    ['sIcons', 'Иконки в узлах', { group: 'Схема' }],
    ['sPulses', 'Импульсы по связям', { group: 'Схема' }],
    ['sWave', 'Волна при краже', { group: 'Схема' }],
    ['sBuild', 'Строится и стирается', { group: 'Схема' }],
    ['sLabels', 'Подписи на плитках', { group: 'Схема' }],
    ['sCounters', 'Счётчики сумм', { group: 'Схема' }],
    ['sShadow', 'Теневые связи', { group: 'Схема' }],
    ['sCross', 'Узлы засвечиваются', { group: 'Схема' }],
    ['sRadar', 'Радар', { group: 'Схема' }],
    ['sFoxPath', 'След лисы в схеме', { group: 'Схема' }],
    ['sMiner', 'Шахтёр питает схему', { group: 'Схема' }],
  ];

  // Базовые тайминги (секунды от начала цикла)
  const T = {
    swing: 1.2, // один взмах кирки
    strike: 0.8, // момент удара внутри взмаха
    foxIn: 5.8, // лиса выбегает
    grab: 0.7, // сколько лиса хватает монеты
    escape: 3.1, // бегство до полного исчезновения
  };

  // Расстановка на полу (мировые координаты)
  const Z = -4.9;
  const MINER_X = 3.2;
  const DIG_X = MINER_X + 0.62; // куда бьёт кирка
  const MOUND_X = MINER_X + 0.86; // центр кучи земли
  const MOUND_SCALE = 2; // размер кучи земли
  const PILE_X = MINER_X - 0.8;
  const PILE_START = 7; // монет у шахтёра изначально
  const STEAL = 3; // сколько монет утаскивает лиса
  const FOX_STOP_X = PILE_X - 0.62;
  const FOX_START_X = -5.5;
  const FOX_SPEED = 3.0;
  // путь бегства: сначала влево вдоль переднего края (под окном входа), потом влево вглубь
  const FOX_BEND = [-5.5, Z - 1];
  const FOX_END = [-11, 6];
  const GUARD = [-3.2, Z + 1.3]; // спящий охранник
  const SCARE_RADIUS = 110; // px — насколько близко навести фонарик

  // «Схема» на плитках: узлы и связи (по бокам, чтобы не прятаться за окном входа)
  const NODES = [[-8.5, 0.5], [-6, 3.5], [-9.5, 6.5], [-5.5, 8.5], [6.5, 1.5], [9, 4.5], [5.5, 6], [8, 9]];
  const EDGES = [[0, 1], [1, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [3, 6]];
  const SHADOW_EDGES = [[0, 2], [1, 6], [4, 7], [2, 7], [0, 5]]; // скрытые каналы
  const NODE_ICONS = ['card', 'wallet', 'bank', 'phone', 'safe', 'btc', 'globe', 'key'];
  const LABELS = ['#A7-0x3F', 'mixer', '→ BTC', 'acc 4471', '0x9e…c2', 'drop', 'P2P', 'cash out', '+12 400', '−3 150', 'SWIFT', 'relay 7'];
  const COUNTER_BASE = [12400, 3150, 88210, 540, 27700, 9990, 1480, 64300];
  const RADAR_C = [0, 3.5];
  const MINER_NODE = 4; // узел, в который шахтёр «питает» схему
  const FOX_NODE = 2; // узел, к которому пристыковывается след лисы
  const hash = (a, b) => {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  // Места монет в кучке (локальные координаты относительно центра кучки)
  const PILE_SLOTS = [
    [-0.21, 0], [0, 0], [0.21, 0], [-0.1, 0.07], [0.1, 0.07],
    [-0.31, 0.0], [0.31, 0], [0, 0.14], [-0.2, 0.07], [0.2, 0.07],
    [-0.1, 0.14], [0.1, 0.14], [0, 0.21],
  ];

  class MinerScene {
    constructor(bg, options = {}) {
      this.bg = bg;
      this.enabled = options.enabled !== false;
      this.vis = this.enabled ? 1 : 0;
      // сцена начинается через 2 с после того, как плитки почти проявились
      const intro = bg.opts.intro;
      this.start = options.start ?? intro.delay + intro.grid * 0.85 + 2;
      this.fx = Object.fromEntries(FX.map(([k, , o = {}]) => [k, o.hidden ? true : !!(options.fx && options.fx[k])]));
      this.reset();
    }

    reset() {
      this.scaredAt = null;
      this.cycleIdx = -1;
      this.cycleLen = null;
      this._planKey = null;
    }

    setFx(key, on) {
      this.fx[key] = !!on;
      this._planKey = null;
    }

    /** Когда сцена закончилась — по bg.clock. */
    endTime() {
      return this.start + 1.6 + this.plan().end;
    }

    setEnabled(on) {
      this.enabled = !!on;
    }

    toggle() {
      this.enabled = !this.enabled;
      return this.enabled;
    }

    /* ---------- таймлайн ---------- */

    /**
     * План цикла: когда лиса приходит, взламывает, хватает, убегает и т. д.
     * Зависит от включённых эффектов и от того, пугали ли лису фонариком.
     */
    plan() {
      const key = JSON.stringify(this.fx) + '|' + this.scaredAt;
      if (key === this._planKey) return this._plan;
      const fx = this.fx;
      const dt = 1 / 60;
      const tIn = T.foxIn;
      // проход лисы к монетам: интегрируем скорость (у охранника — на цыпочках)
      const xs = [], modes = [];
      let x = FOX_START_X, t = tIn;
      while (x < FOX_STOP_X - 1e-3 && t < tIn + 15) {
        let v = FOX_SPEED * clamp((FOX_STOP_X - x) / 0.7, 0.2, 1);
        let mode = 0;
        if (fx.guard && Math.abs(x - GUARD[0]) < 1.4) (v = Math.min(v, 1.0)), (mode = 1);
        xs.push(x);
        modes.push(mode);
        x = Math.min(FOX_STOP_X, x + v * dt);
        t += dt;
      }
      xs.push(FOX_STOP_X);
      modes.push(0);
      const arrive = t;
      const grabStart = arrive;
      const grabEnd = grabStart + T.grab;
      const scared = this.scaredAt != null && this.scaredAt < grabEnd ? this.scaredAt : null;
      const escStart = scared ?? grabEnd;
      const escEnd = escStart + T.escape;
      const noticeFrom = scared != null ? scared : arrive + 0.3;
      const p = {
        tIn, dt, xs, modes, arrive, grabStart, grabEnd, scared, escStart, escEnd,
        noticeFrom,
        noticeTo: escStart + 2.6,
        digUntil: noticeFrom - 0.1,
      };
      p.end = escEnd;
      this._planKey = key;
      this._plan = p;
      return p;
    }

    /** Положение лисы на пути к монетам. */
    entryAt(p, tl) {
      const i = clamp(Math.floor((tl - p.tIn) / p.dt), 0, p.xs.length - 1);
      return { x: p.xs[i], mode: p.modes[i], moving: i < p.xs.length - 1 };
    }

    /** Положение лисы при бегстве (k = 0..1). */
    escapeAt(p, k) {
      const x0 = p.scared != null ? this.entryAt(p, p.scared).x : FOX_STOP_X;
      const e = Math.pow(clamp(k, 0, 1), 1.25), u = 1 - e;
      const bend = [Math.min(FOX_BEND[0], x0 - 1.5), FOX_BEND[1]];
      return [u * u * x0 + 2 * u * e * bend[0] + e * e * FOX_END[0], u * u * Z + 2 * u * e * bend[1] + e * e * FOX_END[1]];
    }

    /* ---------- помощники ---------- */

    /** Рисовать в локальных координатах персонажа: единицы — мировые, y вверх. */
    local(x, z, dir, fn, y = 0) {
      const q = this.bg.project(x, y, z);
      if (!q) return;
      const s = this.bg.cam.F / q[2];
      const c = this.ctx;
      c.save();
      c.translate(q[0], q[1]);
      c.scale(s * dir, -s);
      c.lineWidth = 0.032;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      fn(c, s, q);
      c.restore();
    }

    line(c, pts) {
      c.beginPath();
      c.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
      c.stroke();
    }

    shape(c, draw, fill = true) {
      c.beginPath();
      draw(c);
      if (fill) c.fill();
      c.stroke();
    }

    inkA(a) {
      const k = this.pal.ink;
      return `rgba(${k[0] | 0},${k[1] | 0},${k[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
    }

    /** Эффект материализации: видна только часть снизу до h, по краю — светящаяся линия. */
    materialize(c, rev, h, w, drawFn) {
      if (rev >= 1) return drawFn();
      const top = h * rev;
      c.save();
      c.beginPath();
      c.rect(-w, -0.2, w * 2, top + 0.2);
      c.clip();
      drawFn();
      c.restore();
      c.save();
      c.globalAlpha *= 0.9 * Math.sin(Math.PI * rev);
      c.lineWidth = 0.02;
      this.line(c, [-w * 0.8, top, w * 0.8, top]);
      c.globalAlpha *= 0.35;
      c.lineWidth = 0.08;
      this.line(c, [-w * 0.6, top, w * 0.6, top]);
      c.restore();
    }

    /* ---------- персонажи ---------- */

    drawMiner(c, pose) {
      const { swing, turn } = pose;
      c.save();
      if (turn) c.scale(-1, 1);

      // ноги и ботинки
      this.line(c, [-0.05, 0.5, -0.08, 0.26, -0.11, 0.03]);
      this.line(c, [0.07, 0.5, 0.12, 0.27, 0.14, 0.03]);
      c.fillStyle = this.ink;
      for (const x of [-0.1, 0.16]) {
        c.beginPath();
        c.ellipse(x, 0.025, 0.065, 0.028, 0, 0, TAU);
        c.fill();
      }
      c.fillStyle = this.fill;

      // туловище — комбинезон
      const lean = pose.lean || 0;
      c.save();
      c.rotate(-lean);
      this.shape(c, (c) => c.roundRect(-0.14, 0.46, 0.28, 0.42, 0.07));
      this.line(c, [-0.09, 0.86, -0.07, 0.62, 0.07, 0.62, 0.09, 0.86]); // лямки
      c.beginPath();
      c.arc(0, 0.56, 0.025, 0, TAU);
      c.stroke();

      // голова, каска, фонарь
      const hx = 0.02, hy = 1.0;
      this.shape(c, (c) => c.arc(hx, hy, 0.105, 0, TAU));
      c.fillStyle = this.ink;
      c.beginPath();
      c.arc(hx, hy + 0.01, 0.12, rad(8), rad(172));
      c.closePath();
      c.fill();
      this.line(c, [hx - 0.15, hy + 0.02, hx + 0.17, hy + 0.02]);
      c.beginPath();
      c.arc(hx + 0.13, hy + 0.07, 0.03, 0, TAU);
      c.fill();
      // глаз, нос, усы
      c.beginPath();
      c.arc(hx + 0.06, hy - 0.02, 0.014, 0, TAU);
      c.fill();
      c.fillStyle = this.fill;
      this.line(c, [hx + 0.1, hy - 0.03, hx + 0.13, hy - 0.06, hx + 0.1, hy - 0.07]);
      this.line(c, [hx + 0.02, hy - 0.07, hx + 0.07, hy - 0.09, hx + 0.12, hy - 0.08]);
      c.restore();

      // руки и кирка
      const sh = [0.03, 0.8];
      const dir = [Math.cos(swing), Math.sin(swing)];
      const g1 = [sh[0] + dir[0] * 0.3, sh[1] + dir[1] * 0.3];
      const g2 = [g1[0] - dir[0] * 0.1, g1[1] - dir[1] * 0.1];
      const tip = [g1[0] + dir[0] * 0.42, g1[1] + dir[1] * 0.42];
      c.lineWidth = 0.028;
      this.line(c, [g2[0] - dir[0] * 0.04, g2[1] - dir[1] * 0.04, tip[0], tip[1]]);
      const nx = -dir[1], ny = dir[0];
      c.lineWidth = 0.036;
      c.beginPath();
      c.moveTo(tip[0] + nx * 0.19 - dir[0] * 0.05, tip[1] + ny * 0.19 - dir[1] * 0.05);
      c.quadraticCurveTo(tip[0] + dir[0] * 0.05, tip[1] + dir[1] * 0.05, tip[0] - nx * 0.19 - dir[0] * 0.05, tip[1] - ny * 0.19 - dir[1] * 0.05);
      c.stroke();
      c.lineWidth = 0.032;
      for (const [g, off] of [[g1, 0.05], [g2, -0.04]]) {
        const ex = (sh[0] + g[0]) / 2 + off, ey = (sh[1] + g[1]) / 2 - 0.08;
        this.line(c, [sh[0], sh[1], ex, ey, g[0], g[1]]);
        c.fillStyle = this.ink;
        c.beginPath();
        c.arc(g[0], g[1], 0.03, 0, TAU);
        c.fill();
        c.fillStyle = this.fill;
      }
      c.restore();
    }

    drawFox(c, pose) {
      const { gait, run, coin, wag, tiptoe } = pose;
      const bob = run ? Math.abs(Math.sin(gait)) * (tiptoe ? 0.015 : 0.035) : 0;
      c.save();
      c.translate(0, bob);

      // лапы: передние и задние, в противофазе
      const legs = [[0.16, 0], [0.11, Math.PI], [-0.15, Math.PI * 0.5], [-0.2, Math.PI * 1.5]];
      legs.forEach(([x, ph]) => {
        const sw = run ? Math.sin(gait + ph) : 0;
        const lift = run ? Math.max(0, Math.cos(gait + ph)) * (tiptoe ? 0.1 : 0.05) : 0;
        this.line(c, [x, 0.22, x + sw * 0.07, 0.1 + lift, x + sw * 0.1 + 0.02, 0.01 + lift]);
      });

      // хвост — пушистый, с белым кончиком
      const ta = (run ? Math.sin(gait * 0.5) * 0.12 : Math.sin(wag * 9) * 0.25) + 0.15;
      c.save();
      c.translate(-0.24, 0.3);
      c.rotate(ta);
      this.shape(c, (c) => {
        c.moveTo(0.02, 0.04);
        c.bezierCurveTo(-0.15, 0.14, -0.38, 0.12, -0.46, 0.04);
        c.bezierCurveTo(-0.38, -0.05, -0.15, -0.07, 0.02, -0.04);
        c.closePath();
      });
      this.line(c, [-0.33, 0.1, -0.35, -0.02]);
      c.restore();

      // тело
      this.shape(c, (c) => c.ellipse(0, 0.28, 0.27, 0.1, 0, 0, TAU));

      // голова
      const hx = 0.3, hy = 0.38;
      this.shape(c, (c) => {
        c.moveTo(hx - 0.09, hy + 0.05);
        c.lineTo(hx - 0.06, hy + 0.2); // ухо
        c.lineTo(hx - 0.0, hy + 0.08);
        c.lineTo(hx + 0.05, hy + 0.19); // ухо
        c.lineTo(hx + 0.08, hy + 0.05);
        c.quadraticCurveTo(hx + 0.12, hy + 0.01, hx + 0.2, hy - 0.03); // морда
        c.quadraticCurveTo(hx + 0.12, hy - 0.09, hx - 0.02, hy - 0.08);
        c.quadraticCurveTo(hx - 0.12, hy - 0.04, hx - 0.09, hy + 0.05);
        c.closePath();
      });
      c.fillStyle = this.ink;
      // маска вора и её завязки
      c.beginPath();
      c.moveTo(hx - 0.1, hy + 0.03);
      c.lineTo(hx + 0.11, hy + 0.02);
      c.lineTo(hx + 0.1, hy - 0.025);
      c.lineTo(hx - 0.1, hy - 0.02);
      c.closePath();
      c.fill();
      this.line(c, [hx - 0.1, hy + 0.01, hx - 0.17, hy + 0.05]);
      this.line(c, [hx - 0.1, hy, hx - 0.17, hy - 0.03]);
      c.fillStyle = this.fill;
      c.beginPath();
      c.arc(hx + 0.05, hy + 0.003, 0.018, 0, TAU);
      c.fill();
      c.fillStyle = this.ink;
      c.beginPath();
      c.arc(hx + 0.2, hy - 0.03, 0.02, 0, TAU);
      c.fill();
      c.fillStyle = this.fill;

      if (coin) this.drawCoinFlat(c, hx + 0.19, hy - 0.1, 0.065);
      c.restore();
    }

    drawGuard(c, t) {
      // стул
      this.line(c, [-0.18, 0, -0.16, 0.42]);
      this.line(c, [0.16, 0, 0.14, 0.42]);
      this.line(c, [-0.2, 0.42, 0.18, 0.42]);
      this.line(c, [-0.18, 0.42, -0.22, 0.95]);
      // ноги сидящего
      this.line(c, [-0.02, 0.46, 0.22, 0.46, 0.24, 0.03]);
      this.line(c, [-0.06, 0.44, 0.17, 0.44, 0.18, 0.03]);
      c.fillStyle = this.ink;
      for (const x of [0.28, 0.22]) {
        c.beginPath();
        c.ellipse(x, 0.025, 0.06, 0.026, 0, 0, TAU);
        c.fill();
      }
      c.fillStyle = this.fill;
      // туловище, откинулся на спинку
      const breathe = Math.sin(t * 1.6) * 0.012;
      this.shape(c, (c) => c.roundRect(-0.17, 0.44, 0.24, 0.4 + breathe, 0.07));
      // руки сложены на животе
      this.line(c, [-0.05, 0.78, 0.08, 0.64, -0.08, 0.6]);
      // голова свесилась набок
      const hx = 0.02, hy = 0.98 + breathe;
      this.shape(c, (c) => c.arc(hx, hy, 0.1, 0, TAU));
      // закрытые глаза и фуражка
      this.line(c, [hx + 0.03, hy, hx + 0.08, hy - 0.01]);
      c.fillStyle = this.ink;
      c.beginPath();
      c.moveTo(hx - 0.12, hy + 0.05);
      c.lineTo(hx + 0.1, hy + 0.08);
      c.lineTo(hx + 0.18, hy + 0.04);
      c.lineTo(hx + 0.08, hy + 0.14);
      c.lineTo(hx - 0.1, hy + 0.12);
      c.closePath();
      c.fill();
      c.fillStyle = this.fill;
      // Zzz
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.45 + i / 3) % 1;
        const zx = hx + 0.15 + k * 0.25, zy = hy + 0.15 + k * 0.45, s = 0.05 + k * 0.05;
        c.save();
        c.globalAlpha *= Math.sin(Math.PI * k);
        c.lineWidth = 0.022;
        this.line(c, [zx, zy + s, zx + s, zy + s, zx, zy, zx + s, zy]);
        c.restore();
      }
    }

    drawCoinFlat(c, x, y, r) {
      c.save();
      c.lineWidth = Math.min(c.lineWidth, r * 0.28);
      this.shape(c, (c) => c.arc(x, y, r, 0, TAU));
      c.beginPath();
      c.arc(x, y, r * 0.62, 0, TAU);
      c.stroke();
      this.line(c, [x, y - r * 0.35, x, y + r * 0.35]);
      c.restore();
    }

    drawPileCoin(c, x, y) {
      // монета лёжа: две сплющенные эллипсы + боковины
      const rx = 0.1, ry = 0.04, th = 0.035;
      c.save();
      c.lineWidth = 0.018;
      this.shape(c, (c) => {
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI, true);
        c.lineTo(x - rx, y + th);
        c.ellipse(x, y + th, rx, ry, 0, Math.PI, 0, true);
        c.lineTo(x + rx, y);
        c.closePath();
      });
      this.shape(c, (c) => c.ellipse(x, y + th, rx, ry, 0, 0, TAU));
      c.beginPath();
      c.ellipse(x, y + th, rx * 0.55, ry * 0.55, 0, 0, TAU);
      c.stroke();
      c.restore();
    }

    drawMound(c, grow) {
      const h = 0.1 + grow * 0.06;
      this.shape(c, (c) => {
        c.moveTo(-0.28, 0);
        c.quadraticCurveTo(-0.05, h * 2, 0.3, 0);
        c.closePath();
      });
      c.fillStyle = this.ink;
      for (const [x, y] of [[-0.08, 0.05], [0.05, 0.08], [0.12, 0.03], [-0.15, 0.02]]) {
        c.beginPath();
        c.arc(x, y * (1 + grow), 0.012, 0, TAU);
        c.fill();
      }
      c.fillStyle = this.fill;
    }

    drawBang(c, t, y0 = 1.35) {
      const y = y0 + Math.abs(Math.sin(t * 7)) * 0.05;
      c.lineWidth = 0.045;
      this.line(c, [0, y, 0, y + 0.2]);
      c.fillStyle = this.ink;
      c.beginPath();
      c.arc(0, y - 0.07, 0.028, 0, TAU);
      c.fill();
      c.fillStyle = this.fill;
    }

    /* ---------- эффекты ---------- */

    /** Проекция квадрата плитки со «стороной» r вокруг точки пола. */
    tileQuad(x, z, r) {
      const bg = this.bg, ang = rad(bg.opts.angle), ca = Math.cos(ang), sa = Math.sin(ang);
      const pts = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([u, v]) => {
        const a = (u + v) * r, b = (v - u) * r;
        return bg.project(x + a * ca - b * sa, 0, z + a * sa + b * ca);
      });
      return pts.some((q) => !q) ? null : pts;
    }

    /** Текст, лежащий на полу в перспективе. */
    floorText(x, z, text, size, alpha) {
      const bg = this.bg, c = this.ctx;
      const p0 = bg.project(x, 0, z), px = bg.project(x + 1, 0, z), pz = bg.project(x, 0, z + 1);
      if (!p0 || !px || !pz) return;
      const d = bg.dpr, k = size / 32;
      c.save();
      c.setTransform(d * (px[0] - p0[0]) * k, d * (px[1] - p0[1]) * k, -d * (pz[0] - p0[0]) * k, -d * (pz[1] - p0[1]) * k, d * p0[0], d * p0[1]);
      c.font = '600 32px ui-monospace, Menlo, Consolas, monospace';
      c.fillStyle = this.inkA(alpha);
      c.fillText(text, 0, 0);
      c.restore();
    }

    /** Положение узла (с эффектом «засвечивания» узлы переезжают). */
    nodeAt(i, t) {
      const [bx, bz] = NODES[i];
      if (!this.fx.sCross) return { x: bx, z: bz, a: 1, cross: 0 };
      const N = NODES.length, P = 3.2, T0 = 5;
      const pos = (g) => (g === 0 ? [bx, bz] : [bx + (hash(i, g) - 0.5) * 2.4, bz + (hash(g, i + 7) - 0.5) * 2.4]);
      const since = t - T0 - P * i;
      if (since < 0) return { x: bx, z: bz, a: 1, cross: 0 };
      const g = Math.floor(since / (P * N)) + 1;
      const age = since - (g - 1) * P * N;
      if (age < 1.2) {
        const [x, z] = pos(g - 1);
        return { x, z, a: 1 - ease((age - 0.6) / 0.6), cross: ease(age / 0.5) * (1 - ease((age - 0.6) / 0.6)) };
      }
      const [x, z] = pos(g);
      return { x, z, a: ease((age - 1.2) / 0.6), cross: 0 };
    }

    drawIcon(c, kind) {
      const L = (pts) => this.line(c, pts);
      const S = (fn) => this.shape(c, fn);
      c.lineWidth = 0.028;
      switch (kind) {
        case 'card':
          S((c) => c.roundRect(-0.2, 0, 0.4, 0.26, 0.03));
          L([-0.2, 0.18, 0.2, 0.18]);
          c.strokeRect(-0.14, 0.05, 0.08, 0.06);
          break;
        case 'wallet':
          S((c) => c.roundRect(-0.19, 0, 0.38, 0.26, 0.04));
          S((c) => c.roundRect(0.06, 0.08, 0.15, 0.1, 0.03));
          L([-0.17, 0.26, 0.1, 0.33, 0.14, 0.26]);
          break;
        case 'bank':
          S((c) => { c.moveTo(-0.22, 0.24); c.lineTo(0, 0.36); c.lineTo(0.22, 0.24); c.closePath(); });
          for (const x of [-0.14, 0, 0.14]) L([x, 0.04, x, 0.22]);
          L([-0.22, 0.02, 0.22, 0.02]);
          break;
        case 'phone':
          S((c) => c.roundRect(-0.1, 0, 0.2, 0.36, 0.04));
          L([-0.03, 0.31, 0.03, 0.31]);
          L([-0.06, 0.06, 0.06, 0.06]);
          break;
        case 'safe':
          S((c) => c.roundRect(-0.17, 0, 0.34, 0.32, 0.03));
          S((c) => c.arc(0, 0.16, 0.07, 0, TAU));
          L([0, 0.16, 0.04, 0.2]);
          break;
        case 'btc':
          S((c) => c.arc(0, 0.17, 0.17, 0, TAU));
          c.save();
          c.scale(0.01, -0.01);
          c.fillStyle = this.ink;
          c.font = '700 22px system-ui, sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText('₿', 0, -17);
          c.restore();
          break;
        case 'globe':
          S((c) => c.arc(0, 0.17, 0.17, 0, TAU));
          c.beginPath();
          c.ellipse(0, 0.17, 0.07, 0.17, 0, 0, TAU);
          c.stroke();
          L([-0.17, 0.17, 0.17, 0.17]);
          break;
        case 'key':
          S((c) => c.arc(-0.1, 0.17, 0.08, 0, TAU));
          L([-0.02, 0.17, 0.2, 0.17]);
          L([0.14, 0.17, 0.14, 0.1]);
          L([0.19, 0.17, 0.19, 0.11]);
          break;
      }
    }

    /**
     * «Схема» на плитках и все её дополнения.
     * t — время сцены, tl — время внутри цикла, p — план цикла, stolen — сколько монет украдено.
     */
    drawSchema(t, tl, p, stolen) {
      const bg = this.bg, c = this.ctx, fx = this.fx;
      const additive = this.pal.additive;
      const nE = EDGES.length;
      const outro = bg.outro || 0;

      // --- когда что появляется ---
      const edgeK = [], nodeK = [];
      if (fx.sBuild) {
        // связи прорисовываются по одной, как будто маршрут чертят пером; в финале стираются
        const start = EDGES.map((_, e) => 0.6 + e * 0.7);
        const nodeStart = NODES.map((_, i) => Math.min(...EDGES.map(([a, b], e) => (a === i || b === i ? start[e] : 99))));
        EDGES.forEach((_, e) => {
          const erase = clamp(outro * 2 * nE - (nE - 1 - e), 0, 1);
          edgeK[e] = ease((t - start[e]) / 0.6) * (1 - erase);
        });
        NODES.forEach((_, i) => (nodeK[i] = ease((t - nodeStart[i]) / 0.3) * (1 - clamp(outro * 2, 0, 1))));
      } else {
        const appear = (i) => Math.max(0, t - 0.4 - i * 0.3);
        NODES.forEach((_, i) => (nodeK[i] = ease(appear(i) / 0.4)));
        EDGES.forEach(([a, b], e) => (edgeK[e] = ease((Math.min(appear(a), appear(b)) - 0.2) / 0.6)));
      }
      const nodes = NODES.map((_, i) => this.nodeAt(i, t));

      // --- подсветка: радар, волна кражи, прибытие импульсов ---
      const theta = t * 0.8;
      const radarAt = (x, z) => {
        if (!fx.sRadar) return 0;
        let d = (theta - Math.atan2(z - RADAR_C[1], x - RADAR_C[0])) % TAU;
        if (d < 0) d += TAU;
        return Math.exp(-d / 0.45);
      };
      const grabbed = p && stolen > 0 && tl >= p.grabStart;
      const waveAge = grabbed ? tl - p.grabStart : -1;
      const waveOn = fx.sWave && waveAge >= 0 && waveAge < 2.4;
      const waveR = waveAge * 8;
      const waveAt = (x, z) => (waveOn ? Math.exp(-(((Math.hypot(x - PILE_X, z - Z) - waveR) / 1.4) ** 2)) * (1 - waveAge / 2.4) : 0);
      const flash = NODES.map(() => 0);

      // --- радар: веер света по полу ---
      if (fx.sRadar) {
        const Rr = 13, STEPS = 14;
        c.save();
        c.globalCompositeOperation = additive ? 'lighter' : 'source-over';
        const cp = bg.project(RADAR_C[0], 0, RADAR_C[1]);
        for (let j = 0; j < STEPS && cp; j++) {
          const a1 = theta - j * 0.05, a2 = theta - (j + 1) * 0.05;
          const q1 = bg.project(RADAR_C[0] + Math.cos(a1) * Rr, 0, RADAR_C[1] + Math.sin(a1) * Rr);
          const q2 = bg.project(RADAR_C[0] + Math.cos(a2) * Rr, 0, RADAR_C[1] + Math.sin(a2) * Rr);
          if (!q1 || !q2) continue;
          c.fillStyle = this.inkA((additive ? 0.07 : 0.04) * (1 - j / STEPS));
          c.beginPath();
          c.moveTo(cp[0], cp[1]);
          c.lineTo(q1[0], q1[1]);
          c.lineTo(q2[0], q2[1]);
          c.closePath();
          c.fill();
        }
        const qe = bg.project(RADAR_C[0] + Math.cos(theta) * Rr, 0, RADAR_C[1] + Math.sin(theta) * Rr);
        if (cp && qe) {
          c.strokeStyle = this.inkA(0.35);
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(cp[0], cp[1]);
          c.lineTo(qe[0], qe[1]);
          c.stroke();
        }
        c.restore();
      }

      // --- волна от кучки шахтёра при краже ---
      if (waveOn) {
        c.save();
        c.strokeStyle = this.inkA(0.7 * (1 - waveAge / 2.4));
        c.lineWidth = 2;
        c.beginPath();
        for (let k = 0; k <= 64; k++) {
          const a = (k / 64) * TAU;
          const q = bg.project(PILE_X + Math.cos(a) * waveR, 0, Z + Math.sin(a) * waveR);
          if (!q) continue;
          k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]);
        }
        c.stroke();
        c.restore();
      }

      // --- пунктирная линия по полу ---
      const dashed = (A, B, k, alpha, width = 1.2, dash = [6, 5]) => {
        const pa = bg.project(A[0], 0, A[1]);
        const pb = bg.project(lerp(A[0], B[0], k), 0, lerp(A[1], B[1], k));
        if (!pa || !pb) return null;
        c.save();
        c.strokeStyle = this.inkA(alpha);
        c.lineWidth = width;
        c.setLineDash(dash);
        c.lineDashOffset = -t * 18;
        c.beginPath();
        c.moveTo(pa[0], pa[1]);
        c.lineTo(pb[0], pb[1]);
        c.stroke();
        c.restore();
        return pb;
      };

      // --- теневые связи: мигают, будто скрытые каналы на миг проявляются ---
      if (fx.sShadow) {
        SHADOW_EDGES.forEach(([a, b], e) => {
          const A = nodes[a], B = nodes[b];
          const blink = Math.pow(Math.max(0, Math.sin(t * 1.3 + e * 2.1)), 6);
          const al = 0.5 * blink * Math.min(nodeK[a], nodeK[b]) * Math.min(A.a, B.a);
          if (al > 0.01) dashed([A.x, A.z], [B.x, B.z], 1, al, 1, [2, 7]);
        });
      }

      // --- основные связи + импульсы ---
      EDGES.forEach(([a, b], e) => {
        const k = edgeK[e];
        if (k <= 0) return;
        const A = nodes[a], B = nodes[b];
        const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
        const boost = radarAt(mx, mz) * 0.5 + waveAt(mx, mz);
        const vis = Math.min(A.a, B.a);
        const tip = dashed([A.x, A.z], [B.x, B.z], k, (0.45 + 0.5 * boost) * vis, 1.2 + boost);
        // перо, которое чертит связь
        if (fx.sBuild && k > 0 && k < 1 && tip) {
          c.save();
          c.fillStyle = this.ink;
          c.beginPath();
          c.arc(tip[0], tip[1], 2.5, 0, TAU);
          c.fill();
          c.restore();
        }
        if (fx.sPulses && k >= 1 && vis > 0.5) {
          const sp = 0.32 + (e % 3) * 0.08;
          const u = (t * sp + e * 0.37) % 1;
          const head = bg.project(lerp(A.x, B.x, u), 0, lerp(A.z, B.z, u));
          const tail = bg.project(lerp(A.x, B.x, Math.max(0, u - 0.12)), 0, lerp(A.z, B.z, Math.max(0, u - 0.12)));
          if (head && tail) {
            c.save();
            c.globalCompositeOperation = additive ? 'lighter' : 'source-over';
            const g = c.createLinearGradient(tail[0], tail[1], head[0], head[1]);
            g.addColorStop(0, this.inkA(0));
            g.addColorStop(1, this.inkA(0.95));
            c.strokeStyle = g;
            c.lineWidth = 2.2;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(tail[0], tail[1]);
            c.lineTo(head[0], head[1]);
            c.stroke();
            c.fillStyle = this.inkA(0.95);
            c.beginPath();
            c.arc(head[0], head[1], 2.4, 0, TAU);
            c.fill();
            c.restore();
          }
          if (u < 0.3) flash[b] = Math.max(flash[b], 1 - u / 0.3);
        }
      });

      // --- шахтёр «питает» схему: импульс от кучки к узлу на каждый удар кирки ---
      if (fx.sMiner && nodeK[MINER_NODE] > 0) {
        const N = nodes[MINER_NODE];
        dashed([PILE_X, Z], [N.x, N.z], 1, 0.28 * nodeK[MINER_NODE] * N.a, 1, [3, 5]);
        if (tl >= T.strike && p && tl < p.digUntil + 1.1) {
          const last = Math.floor((tl - T.strike) / T.swing) * T.swing + T.strike;
          const k = (tl - last) / 1.1;
          if (k < 1 && last < p.digUntil) {
            const q = bg.project(lerp(PILE_X, N.x, k), 0, lerp(Z, N.z, k));
            if (q) {
              c.save();
              c.globalCompositeOperation = additive ? 'lighter' : 'source-over';
              c.fillStyle = this.inkA(0.95);
              c.beginPath();
              c.arc(q[0], q[1], 2.6, 0, TAU);
              c.fill();
              c.restore();
            }
            if (k > 0.85) flash[MINER_NODE] = Math.max(flash[MINER_NODE], (k - 0.85) / 0.15);
          }
        }
      }

      // --- след лисы становится новой связью схемы ---
      if (fx.sFoxPath && p && tl >= p.escStart) {
        const kk = Math.min(1, (tl - p.escStart) / T.escape);
        c.save();
        c.strokeStyle = this.inkA(0.55);
        c.lineWidth = 1.3;
        c.setLineDash([6, 5]);
        c.lineDashOffset = -t * 18;
        c.beginPath();
        let last = null;
        for (let k = 0; k <= kk + 1e-6; k += 0.02) {
          const [x, z] = this.escapeAt(p, k);
          const q = bg.project(x, 0, z);
          if (!q) continue;
          last ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]);
          last = [x, z];
        }
        c.stroke();
        c.restore();
        if (kk >= 1 && last) {
          const N = nodes[FOX_NODE];
          dashed(last, [N.x, N.z], ease((tl - p.escEnd) / 0.6), 0.55);
        }
      }

      // --- узлы: подсвеченные плитки ---
      nodes.forEach((n, i) => {
        const k = nodeK[i] * n.a;
        if (k <= 0) return;
        const boost = Math.max(flash[i], radarAt(n.x, n.z), waveAt(n.x, n.z));
        const pulse = 0.6 + 0.4 * Math.sin(t * 2.4 + i);
        const pts = this.tileQuad(n.x, n.z, 0.34 * nodeK[i]);
        if (!pts) return;
        c.save();
        c.globalAlpha *= n.a;
        c.beginPath();
        pts.forEach((q, j) => (j ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        c.closePath();
        c.fillStyle = this.inkA(0.12 * pulse + 0.35 * boost);
        c.fill();
        c.strokeStyle = this.inkA(0.75 + 0.25 * boost);
        c.lineWidth = 1.3 + boost;
        c.stroke();
        // крест — узел засвечен
        if (n.cross > 0) {
          const [a1, b1, a2, b2] = pts;
          c.strokeStyle = this.inkA(0.95);
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(a1[0], a1[1]);
          c.lineTo(lerp(a1[0], a2[0], n.cross), lerp(a1[1], a2[1], n.cross));
          c.moveTo(b1[0], b1[1]);
          c.lineTo(lerp(b1[0], b2[0], n.cross), lerp(b1[1], b2[1], n.cross));
          c.stroke();
        }
        c.restore();

        // подписи, лежащие на плитках
        if (fx.sLabels) {
          const li = Math.floor(hash(i, Math.floor(t / 2.7 + i * 0.37)) * LABELS.length);
          this.floorText(n.x + 0.45, n.z - 0.3, LABELS[li], 0.3, 0.6 * k);
        }
        // иконки над узлами
        if (fx.sIcons) {
          c.save();
          c.globalAlpha *= k;
          this.local(n.x, n.z, 1, (c) => {
            c.translate(-0.02, 0.1 + Math.sin(t * 1.8 + i) * 0.03);
            this.drawIcon(c, NODE_ICONS[i % NODE_ICONS.length]);
          });
          c.restore();
        }
        // счётчики сумм
        if (fx.sCounters) {
          const v = COUNTER_BASE[i % COUNTER_BASE.length] + Math.floor(t * (7 + i * 3));
          c.save();
          c.globalAlpha *= k;
          this.local(n.x, n.z, 1, (c) => {
            c.scale(0.01, -0.01);
            c.font = '600 20px ui-monospace, Menlo, Consolas, monospace';
            c.textAlign = 'center';
            c.fillStyle = this.inkA(0.85);
            c.fillText('$ ' + v.toLocaleString('ru-RU'), 0, fx.sIcons ? -56 : -18);
          });
          c.restore();
        }
      });
    }

    /** Все положения лисы до момента tl (для следов и дорожки монет). */
    foxPathPoints(p, tl, step) {
      const out = [];
      let last = null, dist = 0;
      const push = (x, z, time, dir) => {
        if (last) dist += Math.hypot(x - last[0], z - last[1]);
        if (!last || dist >= step) {
          out.push({ x, z, time, dir, i: out.length });
          dist = 0;
        }
        last = [x, z];
      };
      const entryEnd = Math.min(tl, p.scared ?? p.arrive, p.arrive);
      for (let time = p.tIn; time <= entryEnd; time += 0.05) push(this.entryAt(p, time).x, Z, time, 1);
      for (let time = p.escStart; time <= Math.min(tl, p.escEnd); time += 0.04) {
        const [x, z] = this.escapeAt(p, (time - p.escStart) / T.escape);
        push(x, z, time, -1);
      }
      return out;
    }

    drawPaws(p, tl) {
      for (const pt of this.foxPathPoints(p, tl, 0.32)) {
        const age = tl - pt.time;
        const a = clamp(1 - age / 3.5, 0, 1);
        if (a <= 0) continue;
        const side = pt.i % 2 ? 0.07 : -0.07;
        this.local(pt.x, pt.z + side, pt.dir, (c) => {
          c.globalAlpha *= a * 0.85;
          c.scale(1, 0.45);
          c.fillStyle = this.ink;
          c.beginPath();
          c.ellipse(0, 0, 0.045, 0.035, 0, 0, TAU);
          c.fill();
          for (const [dx, dy] of [[0.06, 0.035], [0.075, 0], [0.06, -0.035]]) {
            c.beginPath();
            c.arc(dx, dy, 0.016, 0, TAU);
            c.fill();
          }
        });
      }
    }

    /* ---------- кадр ---------- */

    draw(pal, real) {
      const bg = this.bg;
      const fx = this.fx;
      this.vis += clamp((this.enabled ? 1 : 0) - this.vis, -real / 0.5, real / 0.5);
      // в финале цикла сцена тает быстрее плиток
      this.alpha = this.vis * (1 - ease((bg.outro || 0) * 1.8));
      if (this.alpha <= 0) return;
      const t = bg.clock - this.start;
      if (t <= 0) {
        this.reset();
        return;
      }

      const c = (this.ctx = bg.ctx);
      this.pal = pal;
      this.ink = this.inkA(1);
      this.fill = `rgba(${pal.fill[0] | 0},${pal.fill[1] | 0},${pal.fill[2] | 0},1)`;
      const additive = pal.additive;
      c.save();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = this.alpha;
      c.strokeStyle = this.ink;
      c.fillStyle = this.fill;

      const rev = ease(t / 1.6); // материализация
      // Длину цикла фиксируем в его начале: если лису спугнули, план укорачивается,
      // и без этого время «перескакивало» бы в новый цикл, а лиса появлялась снова.
      // Когда фон повторяется сам (bg.opts.loop), сцена не зацикливается — после
      // бегства лисы начинается финал фона, и всё запускается заново.
      if (this.cycleIdx < 0 || this.cycleLen == null) {
        this.scaredAt = null;
        this.cycleLen = this.plan().end + 0.6;
      }
      const loops = !(bg.opts.loop && this.enabled);
      const idx = t < 1.6 ? -1 : loops ? Math.floor((t - 1.6) / this.cycleLen) : 0;
      if (idx !== this.cycleIdx) {
        this.cycleIdx = idx;
        this.scaredAt = null;
        this.cycleLen = this.plan().end + 0.6;
      }
      const p = this.plan();
      const tl = t < 1.6 ? -1 : loops ? (t - 1.6) % this.cycleLen : t - 1.6; // время внутри цикла

      // ---- удары кирки ----
      let swing = rad(-25), lean = 0, strikeAge = 99;
      if (tl >= 0 && tl < p.digUntil) {
        const u = tl % T.swing;
        const up = rad(118), down = rad(-38), rest = rad(-25);
        if (u < 0.62) swing = lerp(rest, up, ease(u / 0.62));
        else if (u < T.strike) swing = lerp(up, down, Math.pow((u - 0.62) / (T.strike - 0.62), 2));
        else swing = lerp(down, rest, ease((u - T.strike) / (T.swing - T.strike)));
        lean = u > 0.62 && u < 1.0 ? 0.12 * Math.sin(Math.PI * clamp((u - 0.62) / 0.38, 0, 1)) : 0;
        strikeAge = u - T.strike;
      } else if (tl >= p.digUntil) {
        swing = rad(-65);
      }

      // сколько монет утащено (если лису спугнули — сколько успела)
      const tStolen = Math.min(tl, p.escStart);
      const stolen = tStolen >= p.grabStart ? Math.min(STEAL, Math.floor((tStolen - p.grabStart) / 0.1) + 1) : 0;
      const restore = tl >= 0 && tl < 1.5 && idx > 0 ? ease(tl / 1.5) : 1;

      // ---- схема на плитках (фоном) ----
      if (fx.schema) this.drawSchema(t, tl, p, stolen);

      // ---- следы лап ----
      if (fx.paws && tl >= p.tIn) this.drawPaws(p, tl);

      // ---- спящий охранник ----
      if (fx.guard) {
        this.local(GUARD[0], GUARD[1], 1, (c) => {
          this.materialize(c, rev, 1.2, 0.5, () => this.drawGuard(c, t));
        });
      }

      // ---- земля: куча у места копки ----
      this.local(MOUND_X, Z, 1, (c) => {
        this.materialize(c, rev, 0.3 * MOUND_SCALE, 0.35 * MOUND_SCALE, () => {
          c.save();
          c.scale(MOUND_SCALE, MOUND_SCALE);
          c.lineWidth /= MOUND_SCALE;
          this.drawMound(c, 0.5);
          c.restore();
        });
      });

      // ---- кучка монет ----
      this.local(PILE_X, Z, 1, (c) => {
        this.materialize(c, rev, 0.3, 0.35, () => {
          const n = Math.min(PILE_START, PILE_SLOTS.length);
          for (let i = 0; i < n; i++) {
            const top = i >= n - STEAL; // верхние монеты — те, что утащит лиса
            if (top && n - 1 - i < stolen) continue;
            const a = top ? clamp(restore * STEAL - (i - (n - STEAL)), 0, 1) : 1;
            if (a <= 0) continue;
            c.globalAlpha = this.alpha * a;
            this.drawPileCoin(c, PILE_SLOTS[i][0], PILE_SLOTS[i][1]);
          }
          c.globalAlpha = this.alpha;
        });
      });

      // ---- луч фонаря шахтёра (в тёмной теме) ----
      const turn = tl >= p.noticeFrom && tl < p.noticeTo;
      if (additive && rev > 0.5) {
        const a = bg.project(MINER_X + (turn ? -0.13 : 0.15), 1.07, Z);
        const b1 = bg.project(turn ? MINER_X - 1.3 : DIG_X + 0.5, 0, Z - 0.3);
        const b2 = bg.project(turn ? MINER_X - 1.3 : DIG_X + 0.5, 0, Z + 0.3);
        if (a && b1 && b2) {
          const g = c.createRadialGradient(a[0], a[1], 0, a[0], a[1], Math.hypot(b1[0] - a[0], b1[1] - a[1]));
          g.addColorStop(0, this.inkA(0.22));
          g.addColorStop(1, this.inkA(0));
          c.save();
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = this.alpha * (rev - 0.5) * 2;
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(a[0], a[1]);
          c.lineTo(b1[0], b1[1]);
          c.lineTo(b2[0], b2[1]);
          c.closePath();
          c.fill();
          c.restore();
        }
      }

      // ---- шахтёр ----
      this.local(MINER_X, Z, 1, (c) => {
        this.materialize(c, rev, 1.2, 0.5, () => this.drawMiner(c, { swing, lean, turn }));
        if (turn && tl < p.noticeFrom + 1.8) this.drawBang(c, tl);
      });

      // ---- комья земли при ударе ----
      if (strikeAge >= 0 && strikeAge < 0.4) {
        this.local(DIG_X, Z, 1, (c) => {
          c.translate(0, 0.18);
          c.fillStyle = this.ink;
          for (let i = 0; i < 5; i++) {
            const vx = (i - 2) * 0.35, vy = 1.1 + (i % 2) * 0.4;
            const x = vx * strikeAge, y = vy * strikeAge - 4 * strikeAge * strikeAge;
            if (y < 0) continue;
            c.beginPath();
            c.arc(x, y, 0.018, 0, TAU);
            c.fill();
          }
        });
      }

      // ---- монеты летят к лисе, пока она их хватает ----
      if (tl >= p.grabStart && tl < Math.min(p.grabEnd, p.escStart) + 0.3) {
        this.local(PILE_X, Z, 1, (c) => {
          for (let i = 0; i < stolen; i++) {
            const age = tl - p.grabStart - i * 0.1;
            if (age > 0.3) continue;
            const x = -0.15 - age * 0.9, y = 0.1 + age * 1.2;
            c.globalAlpha = this.alpha * (1 - age / 0.3);
            this.drawCoinFlat(c, x, y, 0.04);
          }
          c.globalAlpha = this.alpha;
        });
      }

      // ---- лиса ----
      let foxScreen = null;
      if (tl >= p.tIn && tl < p.escEnd) {
        let x, z, dir = 1, run = true, gait, alpha = 1, tiptoe = false;
        const loot = stolen > 0;
        if (tl < p.escStart && tl < p.arrive) {
          const e = this.entryAt(p, tl);
          x = e.x;
          z = Z;
          gait = (x - FOX_START_X) * 11;
          run = e.moving;
          tiptoe = e.mode === 1;
          alpha = clamp((tl - p.tIn) / 0.3, 0, 1);
        } else if (tl < p.escStart) {
          x = FOX_STOP_X;
          z = Z;
          run = false;
          gait = 0;
        } else {
          const k = (tl - p.escStart) / T.escape;
          [x, z] = this.escapeAt(p, k);
          dir = -1;
          gait = k * 90;
          const q = bg.project(x, 0, z);
          alpha = q ? clamp(1 - (q[2] - 8) / 16, 0, 1) * (1 - ease((k - 0.55) / 0.45)) : 0; // растворяется в бездне
        }
        c.globalAlpha = this.alpha * alpha;
        this.local(x, z, dir, (c) => {
          this.drawFox(c, { gait, run, wag: tl, tiptoe, coin: loot });
          if (p.scared != null && tl >= p.scared && tl < p.scared + 0.9) this.drawBang(c, tl, 0.62);
        });
        c.globalAlpha = this.alpha;
        foxScreen = bg.project(x, 0.3, z);
      }

      // ---- курсор-фонарик ----
      const ptr = bg.pointer;
      if (fx.flashlight && ptr.active) {
        c.save();
        c.globalCompositeOperation = additive ? 'lighter' : 'source-over';
        const g = c.createRadialGradient(ptr.px, ptr.py, 0, ptr.px, ptr.py, 150);
        g.addColorStop(0, this.inkA(additive ? 0.16 : 0.07));
        g.addColorStop(1, this.inkA(0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(ptr.px, ptr.py, 150, 0, TAU);
        c.fill();
        c.restore();
        // лису поймали лучом — пугается и убегает
        if (foxScreen && this.scaredAt == null && tl >= p.tIn + 0.3 && tl < p.escStart &&
            Math.hypot(foxScreen[0] - ptr.px, foxScreen[1] - ptr.py) < SCARE_RADIUS) {
          this.scaredAt = tl;
        }
      }

      c.restore();
    }
  }

  MinerScene.FX = FX;
  window.MinerScene = MinerScene;
})();
