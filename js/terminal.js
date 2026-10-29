/*
 * Terminal —— 文本模式字符缓冲、滚动缓冲与渲染
 * ---------------------------------------------------------------
 * Terminal 只维护状态（字符/属性网格、光标、历史行），可在 Node 中无头运行；
 * TextRenderer 把它画到 720×400 的 canvas（9×16 字符单元，VGA 文本模式）；
 * renderToGraphics 在 MODE 13 控制台下用 8×8 字体画进图形缓冲（40×25）。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  /** CGA/EGA 16 色调色板 */
  const CGA = [
    '#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
    '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'
  ];

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }

  /** 单色荧光主题：按亮度映射到一种荧光色 */
  function mono(tint) {
    return CGA.map(hex => {
      const [r, g, b] = hexToRgb(hex);
      const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const k = l === 0 ? 0 : 0.25 + 0.75 * Math.pow(l, 0.7);
      return rgbToHex(tint[0] * k, tint[1] * k, tint[2] * k);
    });
  }

  /** 可切换的颜色主题 */
  const THEMES = {
    classic: { name: 'Classic VGA', palette: CGA.slice() },
    green: { name: 'Green Phosphor', palette: mono([0x33, 0xFF, 0x66]) },
    amber: { name: 'Amber', palette: mono([0xFF, 0xB0, 0x00]) },
    blue: { name: 'Blue Shell', palette: CGA.map((c, i) => i === 0 ? '#0000AA' : i === 1 ? '#000000' : i === 7 ? '#FFFFFF' : c) }
  };

  /**
   * 文本终端：字符网格 + 光标 + 滚动缓冲。
   */
  class Terminal {
    /**
     * @param {{cols?:number, rows?:number, scrollback?:number}} [opts]
     */
    constructor(opts = {}) {
      this.cols = opts.cols || 80;
      this.rows = opts.rows || 25;
      this.scrollbackLimit = Math.max(500, opts.scrollback || 1000);
      this.attr = 0x07;
      this.x = 0;
      this.y = 0;
      this.scrollback = [];
      this.viewOffset = 0;
      this.cursorVisible = true;
      this.cursorShape = 'block';
      this.dirty = true;
      /** @type {null|function(string):void} 完成一行时回调（无障碍播报） */
      this.onLine = null;
      /** @type {null|function():void} 响铃回调 */
      this.onBell = null;
      this._alloc();
    }

    _alloc() {
      const n = this.cols * this.rows;
      this.chars = new Uint16Array(n).fill(32);
      this.attrs = new Uint8Array(n).fill(this.attr);
    }

    /** 改变网格尺寸（清屏，保留历史） */
    resize(cols, rows) {
      this.cols = cols;
      this.rows = rows;
      this._alloc();
      this.x = this.y = 0;
      this.viewOffset = 0;
      this.dirty = true;
    }

    /** 清屏并把光标移到左上角 */
    clear() {
      this.chars.fill(32);
      this.attrs.fill(this.attr);
      this.x = this.y = 0;
      this.viewOffset = 0;
      this.dirty = true;
    }

    /** 写入单元格 */
    setCell(x, y, code, attr = this.attr) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const i = y * this.cols + x;
      this.chars[i] = code;
      this.attrs[i] = attr;
      this.dirty = true;
    }

    /** 读取单元格 @returns {{code:number, attr:number}} */
    getCell(x, y) {
      const i = y * this.cols + x;
      return { code: this.chars[i], attr: this.attrs[i] };
    }

    /** 设置光标位置 */
    gotoXY(x, y) {
      this.x = Math.max(0, Math.min(this.cols - 1, x));
      this.y = Math.max(0, Math.min(this.rows - 1, y));
      this.dirty = true;
    }

    /** 屏幕整体上滚 n 行，顶行进入滚动缓冲 */
    scrollUp(n = 1) {
      for (let k = 0; k < n; k++) {
        const line = {
          chars: this.chars.slice(0, this.cols),
          attrs: this.attrs.slice(0, this.cols)
        };
        this.scrollback.push(line);
        if (this.scrollback.length > this.scrollbackLimit) this.scrollback.shift();
        else if (this.viewOffset > 0) this.viewOffset++;
        this.chars.copyWithin(0, this.cols);
        this.attrs.copyWithin(0, this.cols);
        this.chars.fill(32, (this.rows - 1) * this.cols);
        this.attrs.fill(this.attr, (this.rows - 1) * this.cols);
      }
      this.y = Math.max(0, this.y - n);
      this.dirty = true;
    }

    /** 读取屏幕某行的文本 */
    lineText(y) {
      let s = '';
      for (let x = 0; x < this.cols; x++) s += String.fromCharCode(this.chars[y * this.cols + x]);
      return s.replace(/\s+$/, '');
    }

    _newline() {
      if (this.onLine) this.onLine(this.lineText(this.y));
      this.x = 0;
      this.y++;
      if (this.y >= this.rows) this.scrollUp(this.y - this.rows + 1);
    }

    /** 输出单个字符（处理控制字符、自动换行与滚屏） */
    putChar(ch) {
      const code = ch.charCodeAt(0);
      switch (ch) {
        case '\n': this._newline(); break;
        case '\r': this.x = 0; break;
        case '\b': if (this.x > 0) this.x--; break;
        case '\t': do { this.putChar(' '); } while (this.x % 8 !== 0); break;
        case '\x07': if (this.onBell) this.onBell(); break;
        default:
          this.setCell(this.x, this.y, code, this.attr);
          this.x++;
          if (this.x >= this.cols) {
            this.x = 0;
            this.y++;
            if (this.y >= this.rows) this.scrollUp(this.y - this.rows + 1);
          }
      }
      this.dirty = true;
    }

    /** 输出字符串（\n 视为 CR+LF） */
    write(str) {
      str = String(str).replace(/\r\n/g, '\n');
      for (const ch of str) this.putChar(ch.length > 1 ? '?' : ch);
    }

    /** 输出一行 */
    writeln(str = '') { this.write(str + '\n'); }

    /** 若光标不在行首则换行 */
    ensureLineStart() { if (this.x !== 0) this.write('\n'); }

    /** 调整历史查看偏移（正数向上） */
    scrollView(delta) {
      const max = this.scrollback.length;
      this.viewOffset = Math.max(0, Math.min(max, this.viewOffset + delta));
      this.dirty = true;
    }

    /** 回到最新输出 */
    resetView() { if (this.viewOffset) { this.viewOffset = 0; this.dirty = true; } }

    /**
     * 取显示行（考虑历史偏移）。
     * @returns {{chars:Uint16Array, attrs:Uint8Array, offset:number}}
     */
    viewRow(r) {
      const sb = this.scrollback.length;
      const idx = sb - this.viewOffset + r;
      if (idx < sb) return { chars: this.scrollback[idx].chars, attrs: this.scrollback[idx].attrs, offset: 0 };
      return { chars: this.chars, attrs: this.attrs, offset: (idx - sb) * this.cols };
    }

    /** 保存屏幕快照（进入图形程序前） */
    snapshot() {
      return {
        cols: this.cols, rows: this.rows, x: this.x, y: this.y, attr: this.attr,
        chars: this.chars.slice(), attrs: this.attrs.slice(), cursorVisible: this.cursorVisible
      };
    }

    /** 恢复快照 */
    restore(s) {
      if (!s) return;
      if (s.cols !== this.cols || s.rows !== this.rows) { this.cols = s.cols; this.rows = s.rows; this._alloc(); }
      this.chars.set(s.chars);
      this.attrs.set(s.attrs);
      this.x = s.x; this.y = s.y; this.attr = s.attr; this.cursorVisible = s.cursorVisible;
      this.viewOffset = 0;
      this.dirty = true;
    }

    /** 屏幕全部文本（测试用） */
    screenText() {
      const out = [];
      for (let y = 0; y < this.rows; y++) out.push(this.lineText(y));
      return out.join('\n').replace(/\s+$/, '');
    }

    /** 历史 + 屏幕文本（测试用） */
    allText() {
      const lines = this.scrollback.map(l => String.fromCharCode.apply(null, l.chars).replace(/\s+$/, ''));
      return (lines.join('\n') + '\n' + this.screenText()).replace(/^\n+/, '');
    }
  }

  function toUint32(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0; // 小端 RGBA
  }

  /**
   * 文本模式渲染器：9×16 字符单元，画到 canvas 的 ImageData。
   */
  class TextRenderer {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cellW = 9;
      this.cellH = 16;
      this.image = null;
      this.setTheme('classic');
    }

    /** 切换主题 @param {string} name */
    setTheme(name) {
      this.themeName = THEMES[name] ? name : 'classic';
      this.pal = THEMES[this.themeName].palette.map(toUint32);
      this.background = THEMES[this.themeName].palette[0];
    }

    /**
     * 渲染终端。
     * @param {Terminal} term
     * @param {boolean} blinkOn 光标闪烁相位
     */
    render(term, blinkOn) {
      const W = term.cols * this.cellW, H = term.rows * this.cellH;
      if (this.canvas.width !== W || this.canvas.height !== H || !this.image) {
        this.canvas.width = W; this.canvas.height = H;
        this.image = this.ctx.createImageData(W, H);
        this.buf = new Uint32Array(this.image.data.buffer);
      }
      const buf = this.buf, pal = this.pal, Font = DOS.Font;
      for (let r = 0; r < term.rows; r++) {
        const row = term.viewRow(r);
        for (let c = 0; c < term.cols; c++) {
          const idx = row.offset + c;
          const code = idx < row.chars.length ? row.chars[idx] : 32;
          const at = idx < row.attrs.length ? row.attrs[idx] : 7;
          const fg = pal[at & 15], bg = pal[(at >> 4) & 15];
          const g = Font.glyph16(code);
          const ext = Font.extendsRight(code);
          let p = r * this.cellH * W + c * this.cellW;
          for (let y = 0; y < 16; y++, p += W) {
            const bits = g[y];
            buf[p] = bits & 0x80 ? fg : bg; buf[p + 1] = bits & 0x40 ? fg : bg;
            buf[p + 2] = bits & 0x20 ? fg : bg; buf[p + 3] = bits & 0x10 ? fg : bg;
            buf[p + 4] = bits & 0x08 ? fg : bg; buf[p + 5] = bits & 0x04 ? fg : bg;
            buf[p + 6] = bits & 0x02 ? fg : bg; buf[p + 7] = bits & 0x01 ? fg : bg;
            buf[p + 8] = ext && (bits & 0x01) ? fg : bg;
          }
        }
      }
      // 光标：仅在查看最新输出时显示
      if (term.cursorVisible && blinkOn && term.viewOffset === 0 && term.y < term.rows) {
        const ci = term.y * term.cols + term.x;
        const at = ci < term.attrs.length ? term.attrs[ci] : 7;
        const fg = pal[at & 15];
        const top = term.cursorShape === 'block' ? 0 : term.cursorShape === 'half' ? 8 : 13;
        for (let y = top; y < 15; y++) {
          const p = (term.y * this.cellH + y) * W + term.x * this.cellW;
          for (let x = 0; x < 8; x++) buf[p + x] = fg;
        }
      }
      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  /**
   * MODE 13 控制台：用 8×8 字体把终端画进图形后台缓冲。
   * 前 16 个 VGA 调色板项即 CGA 颜色，属性可直接作为颜色索引。
   * @param {Terminal} term
   * @param {object} gfx DOS.Graphics 实例
   * @param {boolean} blinkOn
   */
  function renderToGraphics(term, gfx, blinkOn) {
    const Font = DOS.Font;
    for (let r = 0; r < term.rows; r++) {
      const row = term.viewRow(r);
      for (let c = 0; c < term.cols; c++) {
        const idx = row.offset + c;
        const code = idx < row.chars.length ? row.chars[idx] : 32;
        const at = idx < row.attrs.length ? row.attrs[idx] : 7;
        gfx.drawGlyph(Font.glyph8(code), c * 8, r * 8, at & 15, (at >> 4) & 15);
      }
    }
    if (term.cursorVisible && blinkOn && term.viewOffset === 0) {
      const top = term.cursorShape === 'block' ? 0 : 6;
      gfx.fillRect(term.x * 8, term.y * 8 + top, 8, 8 - top, 7);
    }
    gfx.swap();
  }

  DOS.Terminal = Terminal;
  DOS.TextRenderer = TextRenderer;
  DOS.renderTerminalToGraphics = renderToGraphics;
  DOS.THEMES = THEMES;
  DOS.CGA_PALETTE = CGA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
