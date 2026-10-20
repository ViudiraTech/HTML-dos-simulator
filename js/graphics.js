/*
 * Graphics —— VGA Mode 13h 风格的索引色帧缓冲
 * ---------------------------------------------------------------
 * - 默认 320×200、256 色调色板（与 VGA BIOS 默认调色板结构一致：
 *   0-15 CGA 色，16-31 灰阶，32-247 色相环，248-255 黑）。
 * - 双缓冲：所有绘图写入 back，swap() 复制到 front 并提交到 canvas。
 * - waitVBlank() 以 requestAnimationFrame（无 DOM 时 16.7ms 定时器）模拟 ~60Hz。
 * - 程序可调用 setResolution() 使用非标准分辨率（MARIO 使用 NES 的 256×240，
 *   由界面层做整数倍缩放 + letterbox 居中）。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  /** 生成 VGA 风格默认调色板（RGB 0-255，长度 768） */
  function defaultPalette() {
    const p = new Uint8Array(768);
    const cga = ['000000', '0000AA', '00AA00', '00AAAA', 'AA0000', 'AA00AA', 'AA5500', 'AAAAAA',
      '555555', '5555FF', '55FF55', '55FFFF', 'FF5555', 'FF55FF', 'FFFF55', 'FFFFFF'];
    cga.forEach((h, i) => { const n = parseInt(h, 16); p[i * 3] = n >> 16; p[i * 3 + 1] = (n >> 8) & 255; p[i * 3 + 2] = n & 255; });
    const gray = [0, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 45, 50, 56, 63];
    gray.forEach((g, i) => { const v = Math.round(g * 255 / 63); p[(16 + i) * 3] = p[(16 + i) * 3 + 1] = p[(16 + i) * 3 + 2] = v; });
    // 3 个亮度 × 3 个饱和度 × 24 个色相
    let idx = 32;
    for (const value of [63, 28, 16]) {
      for (const sat of [0, 0.5, 0.72]) {
        const hi = value, lo = Math.round(value * sat);
        // 24 步的色相环：R→Y→G→C→B→M→R
        const seq = [];
        const steps = 4;
        const ramp = (a, b) => { const r = []; for (let i = 0; i < steps; i++) r.push(Math.round(a + (b - a) * i / steps)); return r; };
        const up = ramp(lo, hi), down = ramp(hi, lo);
        for (let i = 0; i < steps; i++) seq.push([hi, up[i], lo]);   // R→Y
        for (let i = 0; i < steps; i++) seq.push([down[i], hi, lo]); // Y→G
        for (let i = 0; i < steps; i++) seq.push([lo, hi, up[i]]);   // G→C
        for (let i = 0; i < steps; i++) seq.push([lo, down[i], hi]); // C→B
        for (let i = 0; i < steps; i++) seq.push([up[i], lo, hi]);   // B→M
        for (let i = 0; i < steps; i++) seq.push([hi, lo, down[i]]); // M→R
        for (const [r, g, b] of seq) {
          p[idx * 3] = Math.round(r * 255 / 63); p[idx * 3 + 1] = Math.round(g * 255 / 63); p[idx * 3 + 2] = Math.round(b * 255 / 63);
          idx++;
        }
      }
    }
    return p; // 248-255 保持黑色
  }

  const DEFAULT_PALETTE = defaultPalette();

  class Graphics {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.image = null;
      this.palette = new Uint8Array(768);
      this.pal32 = new Uint32Array(256);
      this.frames = 0;
      this.onPresent = null;
      this.setResolution(320, 200);
      this.resetPalette();
    }

    /** 绑定 canvas（浏览器） */
    attach(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this._syncCanvas();
    }

    _syncCanvas() {
      if (!this.canvas) return;
      if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
        this.canvas.width = this.width;
        this.canvas.height = this.height;
      }
      this.image = this.ctx.createImageData(this.width, this.height);
      this.image32 = new Uint32Array(this.image.data.buffer);
    }

    /**
     * 设置分辨率并清空缓冲。
     * @param {number} w
     * @param {number} h
     */
    setResolution(w, h) {
      this.width = w;
      this.height = h;
      this.back = new Uint8Array(w * h);
      this.front = new Uint8Array(w * h);
      this.clip = { x0: 0, y0: 0, x1: w, y1: h };
      this._syncCanvas();
    }

    // ---------------- 调色板 ----------------

    /** 恢复默认 256 色调色板 */
    resetPalette() {
      this.palette.set(DEFAULT_PALETTE);
      for (let i = 0; i < 256; i++) this._updatePal32(i);
    }

    _updatePal32(i) {
      const p = this.palette;
      this.pal32[i] = (0xFF000000 | (p[i * 3 + 2] << 16) | (p[i * 3 + 1] << 8) | p[i * 3]) >>> 0;
    }

    /**
     * 修改调色板项（RGB 0-255）。
     * @param {number} i 索引 0-255
     */
    setPalette(i, r, g, b) {
      i &= 255;
      this.palette[i * 3] = r; this.palette[i * 3 + 1] = g; this.palette[i * 3 + 2] = b;
      this._updatePal32(i);
    }

    /** 读取调色板项 @returns {number[]} [r,g,b] */
    getPalette(i) { i &= 255; return [this.palette[i * 3], this.palette[i * 3 + 1], this.palette[i * 3 + 2]]; }

    /** 用 "#RRGGBB" 字符串设置调色板项 */
    setPaletteHex(i, hex) { const n = parseInt(hex.replace('#', ''), 16); this.setPalette(i, n >> 16, (n >> 8) & 255, n & 255); }

    // ---------------- 绘图原语（均写入后台缓冲） ----------------

    /** 用颜色 c 清空后台缓冲 */
    clear(c = 0) { this.back.fill(c); }

    /** 画点 */
    pset(x, y, c) {
      x |= 0; y |= 0;
      const k = this.clip;
      if (x < k.x0 || y < k.y0 || x >= k.x1 || y >= k.y1) return;
      this.back[y * this.width + x] = c;
    }

    /** 读点 */
    pget(x, y) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
      return this.back[y * this.width + x];
    }

    /** Bresenham 直线 */
    line(x0, y0, x1, y1, c) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.pset(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    /** 空心矩形 */
    rect(x, y, w, h, c) {
      if (w <= 0 || h <= 0) return;
      this.line(x, y, x + w - 1, y, c);
      this.line(x, y + h - 1, x + w - 1, y + h - 1, c);
      this.line(x, y, x, y + h - 1, c);
      this.line(x + w - 1, y, x + w - 1, y + h - 1, c);
    }

    /** 实心矩形（已裁剪） */
    fillRect(x, y, w, h, c) {
      const k = this.clip;
      let x0 = Math.max(k.x0, x | 0), y0 = Math.max(k.y0, y | 0);
      const x1 = Math.min(k.x1, (x + w) | 0), y1 = Math.min(k.y1, (y + h) | 0);
      for (let yy = y0; yy < y1; yy++) this.back.fill(c, yy * this.width + x0, yy * this.width + x1);
    }

    /** 中点画圆 */
    circle(cx, cy, r, c) {
      cx |= 0; cy |= 0; r |= 0;
      let x = r, y = 0, err = 1 - r;
      while (x >= y) {
        this.pset(cx + x, cy + y, c); this.pset(cx + y, cy + x, c);
        this.pset(cx - y, cy + x, c); this.pset(cx - x, cy + y, c);
        this.pset(cx - x, cy - y, c); this.pset(cx - y, cy - x, c);
        this.pset(cx + y, cy - x, c); this.pset(cx + x, cy - y, c);
        y++;
        if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
      }
    }

    /** 实心圆 */
    fillCircle(cx, cy, r, c) {
      cx |= 0; cy |= 0; r |= 0;
      for (let dy = -r; dy <= r; dy++) {
        const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
        this.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
      }
    }

    /** 绘制 8×8 字形（bg < 0 为透明背景） */
    drawGlyph(glyph, x, y, fg, bg = -1) {
      for (let r = 0; r < 8; r++) {
        const bits = glyph[r];
        for (let i = 0; i < 8; i++) {
          if (bits & (0x80 >> i)) this.pset(x + i, y + r, fg);
          else if (bg >= 0) this.pset(x + i, y + r, bg);
        }
      }
    }

    /**
     * 8×8 位图字体文本。
     * @param {string} str
     * @param {number} x
     * @param {number} y
     * @param {number} c 前景色索引
     * @param {number} [bg] 背景色索引（省略则透明）
     */
    text(str, x, y, c, bg = -1) {
      let cx = x;
      for (const ch of String(str)) {
        if (ch === '\n') { cx = x; y += 8; continue; }
        this.drawGlyph(DOS.Font.glyph8(ch.charCodeAt(0)), cx, y, c, bg);
        cx += 8;
      }
    }

    /**
     * 位图复制，颜色 0 为透明。
     * @param {{w:number,h:number,data:Uint8Array}} bmp
     * @param {number} x
     * @param {number} y
     * @param {{flipX?:boolean, flipY?:boolean, remap?:Uint8Array|number[], clipBottom?:number}} [opts]
     */
    blit(bmp, x, y, opts = {}) {
      x = Math.round(x); y = Math.round(y);
      const { w, h, data } = bmp;
      const flipX = !!opts.flipX, flipY = !!opts.flipY, remap = opts.remap;
      const k = this.clip;
      const yEnd = opts.clipBottom !== undefined ? Math.min(k.y1, opts.clipBottom) : k.y1;
      const W = this.width, back = this.back;
      for (let sy = 0; sy < h; sy++) {
        const dy = y + sy;
        if (dy < k.y0 || dy >= yEnd) continue;
        const row = (flipY ? h - 1 - sy : sy) * w;
        for (let sx = 0; sx < w; sx++) {
          const dx = x + sx;
          if (dx < k.x0 || dx >= k.x1) continue;
          let c = data[row + (flipX ? w - 1 - sx : sx)];
          if (!c) continue;
          if (remap) c = remap[c];
          if (c) back[dy * W + dx] = c;
        }
      }
    }

    // ---------------- 双缓冲与提交 ----------------

    /** 提交后台缓冲：复制到前台并显示 */
    swap() {
      this.front.set(this.back);
      this.present();
    }

    /** 把前台缓冲经调色板转换后画到 canvas */
    present() {
      this.frames++;
      if (!this.canvas) return;
      if (!this.image || this.image.width !== this.width || this.image.height !== this.height) this._syncCanvas();
      const out = this.image32, front = this.front, pal = this.pal32;
      for (let i = 0; i < front.length; i++) out[i] = pal[front[i]];
      this.ctx.putImageData(this.image, 0, 0);
      if (this.onPresent) this.onPresent();
    }

    /** 等待下一次垂直回扫（约 60Hz） @returns {Promise<number>} 时间戳 */
    waitVBlank() {
      return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(t => resolve(t));
        else setTimeout(() => resolve(Date.now()), 1000 / 60);
      });
    }
  }

  DOS.Graphics = Graphics;
})(typeof globalThis !== 'undefined' ? globalThis : this);
