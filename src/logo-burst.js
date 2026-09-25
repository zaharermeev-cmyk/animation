/**
 * LogoBurst — лиса-логотип разлетается на осколки, осколки падают на пол
 * и из мест падения проявляются плитки. В конце цикла всё идёт в обратную
 * сторону: осколки поднимаются с пола и собираются обратно в лису.
 *
 * Подключение:
 *   bg.burst = new LogoBurst(bg, {
 *     dark: 'logo-dark-still.svg',   // логотип для тёмной темы (светлый)
 *     light: 'logo-light-still.svg', // для светлой темы (тёмный)
 *     anchor: () => rect | null,     // где стоит лиса (иначе — центр экрана)
 *   });
 */
(function () {
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const ease = (t) => smooth(clamp(t, 0, 1));

  const SRC_H = 256; // разрешение логотипа во внутреннем канвасе
  const GRID = 13; // осколков по высоте
  const T = {
    fadeIn: 0.6, // появление лисы при первом запуске
    shatter: 1.4, // момент разрыва
    shake: 0.45, // дрожь перед разрывом
    grow: 1.6, // сколько растёт пятно плиток вокруг упавшего осколка
    flash: 0.9, // вспышка плитки при падении
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

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  class LogoBurst {
    constructor(bg, options = {}) {
      this.bg = bg;
      this.opts = options;
      this.ready = false;
      this.shatterAt = T.shatter;
      this.restAt = T.shatter - T.shake - 0.05; // лиса целая и неподвижна
      this.mask = document.createElement('canvas');
      this.mctx = this.mask.getContext('2d');
      this.load();
    }

    async load() {
      try {
        const [dark, light] = await Promise.all([loadImage(this.opts.dark), loadImage(this.opts.light)]);
        this.aspect = (dark.naturalWidth || dark.width) / (dark.naturalHeight || dark.height) || 1;
        const w = Math.round(SRC_H * this.aspect);
        const bake = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = SRC_H;
          c.getContext('2d').drawImage(img, 0, 0, w, SRC_H);
          return c;
        };
        this.src = { dark: bake(dark), light: bake(light) };
        this.build(w);
        this.ready = true;
      } catch (e) {
        this.ready = false; // без логотипа фон проявляется по-старому, из центра
      }
    }

    build(w) {
      const rand = mulberry32(3);
      const cell = SRC_H / GRID;
      const cols = Math.ceil(w / cell);
      // какие клетки не пустые (на file:// канвас может быть «заражён» — тогда берём все)
      let alpha = null;
      try {
        alpha = this.src.dark.getContext('2d').getImageData(0, 0, w, SRC_H).data;
      } catch (e) {}
      const filled = (cx, cy) => {
        if (!alpha) return true;
        let n = 0, tot = 0;
        for (let y = Math.floor(cy * cell); y < Math.min(SRC_H, (cy + 1) * cell); y += 2) {
          for (let x = Math.floor(cx * cell); x < Math.min(w, (cx + 1) * cell); x += 2) {
            tot++;
            if (alpha[(y * w + x) * 4 + 3] > 40) n++;
          }
        }
        return n / tot > 0.06;
      };

      this.shards = [];
      for (let cy = 0; cy < GRID; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (!filled(cx, cy)) continue;
          const u = (cx + 0.5) * cell / w, v = (cy + 0.5) * cell / SRC_H;
          const dist = Math.hypot(u - 0.5, v - 0.5);
          // левые осколки летят влево, верхние — дальше вглубь
          const x = (u - 0.5) * 20 + lerp(-2.5, 2.5, rand());
          const z = lerp(-6.2, 14, Math.pow(1 - v, 1.1) * 0.85 + rand() * 0.15);
          const launch = T.shatter + dist * 0.5 + rand() * 0.25;
          const dur = lerp(0.95, 1.5, rand());
          this.shards.push({
            sx: cx * cell, sy: cy * cell, sw: Math.min(cell, w - cx * cell), sh: Math.min(cell, SRC_H - cy * cell),
            u, v, x, z, launch, land: launch + dur, dur,
            spin: lerp(-1, 1, rand()) * TAU * 0.9,
            arc: lerp(0.08, 0.22, rand()),
            jitter: rand() * TAU,
          });
        }
      }
      this.revealEnd = Math.max(...this.shards.map((s) => s.land)) + T.grow;
    }

    /** Время анимации лисы: вперёд в начале цикла, назад — в финале. */
    virtualTime() {
      const bg = this.bg;
      if (!this.ready) return bg.clock;
      if (bg.outro > 0) return lerp(this.revealEnd, this.restAt, smooth(bg.outro));
      return bg.clock;
    }

    /** Где и какого размера лиса на экране. */
    box() {
      const bg = this.bg;
      const r = this.opts.anchor && this.opts.anchor();
      if (r && r.width > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
      const h = Math.min(bg.H * 0.3, 260), w = h * this.aspect;
      return { x: (bg.W - w) / 2, y: bg.H * 0.42 - h / 2, w, h };
    }

    active(vt) {
      return this.ready && vt < this.revealEnd;
    }

    /** Маска пола: плитки проявляются кругами вокруг упавших осколков. */
    maskFloor(f, vt) {
      const bg = this.bg;
      const k = 1 / 6;
      const mw = Math.max(1, Math.round(bg.W * k)), mh = Math.max(1, Math.round(bg.H * k));
      if (this.mask.width !== mw || this.mask.height !== mh) {
        this.mask.width = mw;
        this.mask.height = mh;
      }
      const m = this.mctx;
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.clearRect(0, 0, mw, mh);
      m.setTransform(k, 0, 0, k, 0, 0);
      m.fillStyle = '#000';
      const R = Math.max(bg.W, bg.H) * 0.4;
      for (const s of this.shards) {
        const g = ease((vt - s.land) / T.grow);
        if (g <= 0) continue;
        const q = bg.project(s.x, 0, s.z);
        if (!q) continue;
        m.beginPath();
        m.arc(q[0], q[1], R * g, 0, TAU);
        m.fill();
      }
      // под конец дозаливаем углы, чтобы переход к полному полу был незаметным
      const tail = ease((vt - (this.revealEnd - 0.7)) / 0.7);
      if (tail > 0) {
        m.setTransform(1, 0, 0, 1, 0, 0);
        m.globalAlpha = tail;
        m.fillRect(0, 0, mw, mh);
        m.globalAlpha = 1;
      }
      f.save();
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.globalCompositeOperation = 'destination-in';
      f.filter = `blur(${Math.round(18 * bg.dpr)}px)`;
      f.drawImage(this.mask, 0, 0, f.canvas.width, f.canvas.height);
      f.restore();
    }

    draw(pal, vt) {
      if (!this.ready || vt >= this.revealEnd) return;
      const bg = this.bg, c = bg.ctx;
      const src = pal.additive ? this.src.dark : this.src.light;
      const b = this.box();
      const sc = b.h / SRC_H;
      const ink = pal.ink;
      const inkA = (a) => `rgba(${ink[0] | 0},${ink[1] | 0},${ink[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
      c.save();
      c.globalCompositeOperation = 'source-over';

      // лиса целиком (до дрожи)
      if (vt < T.shatter - T.shake) {
        c.globalAlpha = ease(vt / T.fadeIn);
        c.drawImage(src, b.x, b.y, b.w, b.h);
        c.restore();
        return;
      }

      const shake = clamp((vt - (T.shatter - T.shake)) / T.shake, 0, 1);
      const cell = (bg.opts.cell || 0.17) * 1.5; // вспышка ≈ 3×3 плитки пола
      for (const s of this.shards) {
        const hx = b.x + (s.sx + s.sw / 2) * sc, hy = b.y + (s.sy + s.sh / 2) * sc;
        const w = s.sw * sc, h = s.sh * sc;
        if (vt < s.launch) {
          // дрожь и трещины перед разрывом
          const j = shake * 1.6;
          const ox = Math.sin(vt * 55 + s.jitter) * j, oy = Math.cos(vt * 47 + s.jitter) * j;
          const gap = 1 - shake * 0.06;
          c.globalAlpha = 1;
          c.drawImage(src, s.sx, s.sy, s.sw, s.sh, hx - (w * gap) / 2 + ox, hy - (h * gap) / 2 + oy, w * gap, h * gap);
          continue;
        }
        const q = bg.project(s.x, 0, s.z);
        if (!q) continue;
        const k = (vt - s.launch) / s.dur;
        if (k < 1) {
          // полёт по дуге к месту на полу
          const e = smooth(k);
          const x = lerp(hx, q[0], e);
          const y = lerp(hy, q[1], e) - Math.sin(Math.PI * k) * bg.H * s.arc;
          const size = lerp(1, 0.55, e);
          c.save();
          c.globalAlpha = 1 - ease((k - 0.7) / 0.3);
          c.translate(x, y);
          c.rotate(s.spin * e);
          c.drawImage(src, s.sx, s.sy, s.sw, s.sh, (-w * size) / 2, (-h * size) / 2, w * size, h * size);
          c.restore();
        }
        // вспышка плитки в месте падения
        const fk = (vt - s.land + 0.15) / T.flash;
        if (fk > 0 && fk < 1) {
          const pts = [[cell, 0], [0, cell], [-cell, 0], [0, -cell]].map(([dx, dz]) => bg.project(s.x + dx, 0, s.z + dz));
          if (pts.some((p) => !p)) continue;
          const a = Math.sin(Math.PI * Math.min(1, fk * 1.6)) * (1 - fk);
          c.save();
          c.globalCompositeOperation = pal.additive ? 'lighter' : 'source-over';
          c.beginPath();
          pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
          c.closePath();
          c.fillStyle = inkA(0.22 * a);
          c.fill();
          c.strokeStyle = inkA(0.9 * a);
          c.lineWidth = 1.2;
          c.stroke();
          c.restore();
        }
      }
      c.restore();
    }
  }

  window.LogoBurst = LogoBurst;
})();
