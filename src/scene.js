/**
 * MinerScene — сцена на полу: шахтёр долбит киркой землю возле своей кучки монет,
 * прибегает лиса, ворует монеты и убегает в бездну.
 * Всё рисуется линиями одного цвета (--scene-ink) с заливкой цветом фона (--scene-fill),
 * поэтому сцена сама подстраивается под светлую и тёмную тему.
 *
 * Подключение:
 *   const bg = new VeilBackground(canvas);
 *   bg.scene = new MinerScene(bg);
 */
(function () {
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const ease = (t) => smooth(clamp(t, 0, 1));
  const rad = (d) => (d * Math.PI) / 180;

  // Сценарий одного цикла (секунды от начала цикла)
  const T = {
    cycle: 12,
    swing: 1.2, // один взмах кирки
    strike: 0.8, // момент удара внутри взмаха
    digUntil: 8.3, // шахтёр копает до
    foxIn: 5.8, // лиса выбегает
    foxAt: 8.2, // добегает до монет
    foxGrab: 8.9, // схватила — убегает
    foxGone: 12,
    noticeFrom: 8.5, // шахтёр замечает
    noticeTo: 11.4,
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
  const FOX_END = [-0.6, 26];

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
      // сцена начинается, когда плитки почти проявились
      const intro = bg.opts.intro;
      this.start = options.start ?? intro.delay + intro.grid * 0.85;
    }

    setEnabled(on) {
      this.enabled = !!on;
    }

    toggle() {
      this.enabled = !this.enabled;
      return this.enabled;
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
      // рукоять
      c.lineWidth = 0.028;
      this.line(c, [g2[0] - dir[0] * 0.04, g2[1] - dir[1] * 0.04, tip[0], tip[1]]);
      // головка кирки — дуга поперёк рукояти
      const nx = -dir[1], ny = dir[0];
      c.lineWidth = 0.036;
      c.beginPath();
      c.moveTo(tip[0] + nx * 0.19 - dir[0] * 0.05, tip[1] + ny * 0.19 - dir[1] * 0.05);
      c.quadraticCurveTo(tip[0] + dir[0] * 0.05, tip[1] + dir[1] * 0.05, tip[0] - nx * 0.19 - dir[0] * 0.05, tip[1] - ny * 0.19 - dir[1] * 0.05);
      c.stroke();
      c.lineWidth = 0.032;
      // руки: плечо → локоть → кисть
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
      const { gait, run, coin, wag } = pose;
      const bob = run ? Math.abs(Math.sin(gait)) * 0.035 : 0;
      c.save();
      c.translate(0, bob);

      // лапы: передние и задние, в противофазе
      const legs = [[0.16, 0], [0.11, Math.PI], [-0.15, Math.PI * 0.5], [-0.2, Math.PI * 1.5]];
      for (const [x, ph] of legs) {
        const sw = run ? Math.sin(gait + ph) : 0;
        const lift = run ? Math.max(0, Math.cos(gait + ph)) * 0.05 : 0;
        this.line(c, [x, 0.22, x + sw * 0.07, 0.1 + lift, x + sw * 0.1 + 0.02, 0.01 + lift]);
      }

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
      // глаз в маске
      c.fillStyle = this.fill;
      c.beginPath();
      c.arc(hx + 0.05, hy + 0.003, 0.018, 0, TAU);
      c.fill();
      c.fillStyle = this.ink;
      // нос
      c.beginPath();
      c.arc(hx + 0.2, hy - 0.03, 0.02, 0, TAU);
      c.fill();
      c.fillStyle = this.fill;

      // монета в зубах
      if (coin) this.drawCoinFlat(c, hx + 0.19, hy - 0.1, 0.065);
      c.restore();
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

    drawBang(c, t) {
      // «!» над головой, подпрыгивает
      const y = 1.35 + Math.abs(Math.sin(t * 7)) * 0.05;
      c.lineWidth = 0.045;
      this.line(c, [0, y, 0, y + 0.2]);
      c.fillStyle = this.ink;
      c.beginPath();
      c.arc(0, y - 0.07, 0.028, 0, TAU);
      c.fill();
      c.fillStyle = this.fill;
    }

    /* ---------- кадр ---------- */

    draw(pal, real) {
      const bg = this.bg;
      this.vis += clamp((this.enabled ? 1 : 0) - this.vis, -real / 0.5, real / 0.5);
      if (this.vis <= 0) return;
      const t = bg.clock - this.start;
      if (t <= 0) return;

      const c = (this.ctx = bg.ctx);
      this.ink = `rgba(${pal.ink[0] | 0},${pal.ink[1] | 0},${pal.ink[2] | 0},1)`;
      this.fill = `rgba(${pal.fill[0] | 0},${pal.fill[1] | 0},${pal.fill[2] | 0},1)`;
      c.save();
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = this.vis;
      c.strokeStyle = this.ink;
      c.fillStyle = this.fill;

      const rev = ease(t / 1.6); // материализация шахтёра и кучки
      const tl = t < 1.6 ? -1 : (t - 1.6) % T.cycle; // время внутри цикла

      // ---- удары кирки и монеты ----
      let swing = rad(-25), lean = 0, strikeAge = 99;
      if (tl >= 0 && tl < T.digUntil) {
        const u = tl % T.swing;
        const up = rad(118), down = rad(-38), rest = rad(-25);
        if (u < 0.62) swing = lerp(rest, up, ease(u / 0.62));
        else if (u < T.strike) swing = lerp(up, down, Math.pow((u - 0.62) / (T.strike - 0.62), 2));
        else swing = lerp(down, rest, ease((u - T.strike) / (T.swing - T.strike)));
        lean = u > 0.62 && u < 1.0 ? 0.12 * Math.sin(Math.PI * clamp((u - 0.62) / 0.38, 0, 1)) : 0;
        strikeAge = u - T.strike;
      } else if (tl >= T.digUntil) {
        swing = rad(-65);
      }

      // монеты в кучке: лиса утаскивает STEAL штук, в начале следующего цикла они
      // тихо возвращаются (чтобы цикл замыкался)
      const stolen = tl >= T.foxAt ? Math.min(STEAL, Math.floor((tl - T.foxAt) / 0.1) + 1) : 0;
      const firstCycle = t - 1.6 < T.cycle;
      const restore = tl >= 0 && tl < 1.5 && !firstCycle ? ease(tl / 1.5) : 1; // 0 → монет ещё нет

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
            c.globalAlpha = this.vis * a;
            this.drawPileCoin(c, PILE_SLOTS[i][0], PILE_SLOTS[i][1]);
          }
          c.globalAlpha = this.vis;
        });
      });

      // ---- луч фонаря (в тёмной теме) ----
      if (pal.additive && rev > 0.5) {
        const turned = tl >= T.noticeFrom && tl < T.noticeTo;
        const a = this.bg.project(MINER_X + (turned ? -0.13 : 0.15), 1.07, Z);
        const b1 = this.bg.project(turned ? MINER_X - 1.3 : DIG_X + 0.5, 0, Z - 0.3);
        const b2 = this.bg.project(turned ? MINER_X - 1.3 : DIG_X + 0.5, 0, Z + 0.3);
        if (a && b1 && b2) {
          const g = c.createRadialGradient(a[0], a[1], 0, a[0], a[1], Math.hypot(b1[0] - a[0], b1[1] - a[1]));
          g.addColorStop(0, `rgba(${pal.ink[0] | 0},${pal.ink[1] | 0},${pal.ink[2] | 0},0.22)`);
          g.addColorStop(1, `rgba(${pal.ink[0] | 0},${pal.ink[1] | 0},${pal.ink[2] | 0},0)`);
          c.save();
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = this.vis * (rev - 0.5) * 2;
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
      const turn = tl >= T.noticeFrom && tl < T.noticeTo;
      this.local(MINER_X, Z, 1, (c) => {
        this.materialize(c, rev, 1.2, 0.5, () => this.drawMiner(c, { swing, lean, turn }));
        if (turn && tl < T.noticeFrom + 1.8) this.drawBang(c, tl);
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

      // ---- искорки, когда лиса утаскивает монеты ----
      if (tl >= T.foxAt && tl < T.foxGrab + 0.3) {
        this.local(PILE_X, Z, 1, (c) => {
          const n = Math.min(STEAL, Math.floor((tl - T.foxAt) / 0.1) + 1);
          for (let i = 0; i < n; i++) {
            const age = tl - T.foxAt - i * 0.1;
            if (age > 0.3) continue;
            const x = -0.15 - age * 0.9, y = 0.1 + age * 1.2;
            c.globalAlpha = this.vis * (1 - age / 0.3);
            this.drawCoinFlat(c, x, y, 0.04);
          }
          c.globalAlpha = this.vis;
        });
      }

      // ---- лиса ----
      if (tl >= T.foxIn && tl < T.foxGone) {
        let x, z, dir = 1, run = true, gait, coin = false, alpha = 1;
        if (tl < T.foxAt) {
          const k = (tl - T.foxIn) / (T.foxAt - T.foxIn);
          const e = k < 0.85 ? k / 0.85 * 0.93 : 0.93 + ease((k - 0.85) / 0.15) * 0.07;
          x = lerp(FOX_START_X, FOX_STOP_X, e);
          z = Z;
          gait = (x - FOX_START_X) * 11;
          alpha = clamp((tl - T.foxIn) / 0.3, 0, 1);
          if (k > 0.97) run = false;
        } else if (tl < T.foxGrab) {
          x = FOX_STOP_X;
          z = Z;
          run = false;
          gait = 0;
          coin = tl > T.foxAt + 0.15;
        } else {
          const k = (tl - T.foxGrab) / (T.foxGone - T.foxGrab);
          const e = Math.pow(k, 1.4);
          x = lerp(FOX_STOP_X, FOX_END[0], e);
          z = lerp(Z, FOX_END[1], e);
          dir = -1;
          coin = true;
          gait = k * 90;
          const q = this.bg.project(x, 0, z);
          alpha = q ? clamp(1 - (q[2] - 8) / 16, 0, 1) : 0; // растворяется в бездне
        }
        c.globalAlpha = this.vis * alpha;
        this.local(x, z, dir, (c) => this.drawFox(c, { gait, run, coin, wag: tl }));
        c.globalAlpha = this.vis;
      }

      c.restore();
    }
  }

  window.MinerScene = MinerScene;
})();
