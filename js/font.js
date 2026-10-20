/*
 * Font —— 位图字体模块
 * ---------------------------------------------------------------
 * - ASCII 32..126：8×8 点阵（公有领域 font8x8_basic 风格，最低位为最左像素）。
 * - 制表符、方块、箭头等 CP437 常用字形由程序生成，避免手工录入。
 * - 文本模式使用 8×16（8×8 行加倍并保留 1 行行距；制表字形原生 16 行以保证首尾相接），
 *   MODE 13 控制台与 Graphics.text 使用 8×8。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  // 95 个字形（空格到 ~），每个 16 位十六进制 = 8 行
  const ASCII = (
    '0000000000000000 183C3C1818001800 3636000000000000 36367F367F363600 ' +
    '0C3E031E301F0C00 006333180C666300 1C361C6E3B336E00 0606030000000000 ' +
    '180C0606060C1800 060C1818180C0600 00663CFF3C660000 000C0C3F0C0C0000 ' +
    '00000000000C0C06 0000003F00000000 00000000000C0C00 6030180C06030100 ' +
    '3E63737B6F673E00 0C0E0C0C0C0C3F00 1E33301C06333F00 1E33301C30331E00 ' +
    '383C36337F307800 3F031F3030331E00 1C06031F33331E00 3F3330180C0C0C00 ' +
    '1E33331E33331E00 1E33333E30180E00 000C0C00000C0C00 000C0C00000C0C06 ' +
    '180C0603060C1800 00003F00003F0000 060C1830180C0600 1E3330180C000C00 ' +
    '3E637B7B7B031E00 0C1E33333F333300 3F66663E66663F00 3C66030303663C00 ' +
    '1F36666666361F00 7F46161E16467F00 7F46161E16060F00 3C66030373667C00 ' +
    '3333333F33333300 1E0C0C0C0C0C1E00 7830303033331E00 6766361E36666700 ' +
    '0F06060646667F00 63777F7F6B636300 63676F7B73636300 1C36636363361C00 ' +
    '3F66663E06060F00 1E3333333B1E3800 3F66663E36666700 1E33070E38331E00 ' +
    '3F2D0C0C0C0C1E00 3333333333333F00 33333333331E0C00 6363636B7F776300 ' +
    '6363361C1C366300 3333331E0C0C1E00 7F6331184C667F00 1E06060606061E00 ' +
    '03060C1830604000 1E18181818181E00 081C366300000000 00000000000000FF ' +
    '0C0C180000000000 00001E303E336E00 0706063E66663B00 00001E3303331E00 ' +
    '3830303E33336E00 00001E333F031E00 1C36060F06060F00 00006E33333E301F ' +
    '0706366E66666700 0C000E0C0C0C1E00 300030303033331E 070666361E366700 ' +
    '0E0C0C0C0C0C1E00 0000337F7F6B6300 00001F3333333300 00001E3333331E00 ' +
    '00003B66663E060F 00006E33333E3078 00003B6E66060F00 00003E031E301F00 ' +
    '080C3E0C0C2C1800 0000333333336E00 00003333331E0C00 0000636B7F7F3600 ' +
    '000063361C366300 00003333333E301F 00003F190C263F00 380C0C070C0C3800 ' +
    '1818180018181800 070C0C380C0C0700 6E3B000000000000'
  ).split(' ');

  /** 将 LSB-left 字节转换为 MSB-left，便于渲染时用 0x80>>x 取位 */
  function rev(b) {
    let r = 0;
    for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i;
    return r;
  }

  // 制表符：[上, 下, 左, 右]，0=无 1=单线 2=双线
  const BOX = {
    '─': [0, 0, 1, 1], '│': [1, 1, 0, 0], '┌': [0, 1, 0, 1], '┐': [0, 1, 1, 0],
    '└': [1, 0, 0, 1], '┘': [1, 0, 1, 0], '├': [1, 1, 0, 1], '┤': [1, 1, 1, 0],
    '┬': [0, 1, 1, 1], '┴': [1, 0, 1, 1], '┼': [1, 1, 1, 1],
    '═': [0, 0, 2, 2], '║': [2, 2, 0, 0], '╔': [0, 2, 0, 2], '╗': [0, 2, 2, 0],
    '╚': [2, 0, 0, 2], '╝': [2, 0, 2, 0], '╠': [2, 2, 0, 2], '╣': [2, 2, 2, 0],
    '╦': [0, 2, 2, 2], '╩': [2, 0, 2, 2], '╬': [2, 2, 2, 2]
  };

  /** 生成制表字形：返回 h 行的 MSB-left 位图 */
  function boxGlyph(spec, h) {
    const g = new Uint8Array(h);
    const [u, d, l, r] = spec;
    const cy = h === 16 ? 7 : 3;
    const hRows = (style) => style === 2 ? (h === 16 ? [5, 9] : [2, 5]) : (h === 16 ? [7, 8] : [3]);
    const vCols = (style) => style === 2 ? [2, 5] : [3, 4];
    const setPix = (x, y) => { if (x >= 0 && x < 8 && y >= 0 && y < h) g[y] |= 0x80 >> x; };
    const vStyle = u || d, hStyle = l || r;
    // 竖线
    if (u) for (const c of vCols(u)) for (let y = 0; y <= (hStyle ? Math.max(...hRows(hStyle)) : cy); y++) setPix(c, y);
    if (d) for (const c of vCols(d)) for (let y = hStyle ? Math.min(...hRows(hStyle)) : cy; y < h; y++) setPix(c, y);
    // 横线
    if (l) for (const row of hRows(l)) for (let x = 0; x <= (vStyle ? Math.max(...vCols(vStyle)) : 4); x++) setPix(x, row);
    if (r) for (const row of hRows(r)) for (let x = vStyle ? Math.min(...vCols(vStyle)) : 3; x < 8; x++) setPix(x, row);
    return g;
  }

  /** 由像素判定函数生成字形 */
  function fnGlyph(h, fn) {
    const g = new Uint8Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) if (fn(x, y, h)) g[y] |= 0x80 >> x;
    return g;
  }

  const SPECIAL = {
    '█': () => true,
    '▀': (x, y, h) => y < h / 2,
    '▄': (x, y, h) => y >= h / 2,
    '▌': (x) => x < 4,
    '▐': (x) => x >= 4,
    '░': (x, y) => (y % 2 === 0 && x % 4 === 0) || (y % 2 === 1 && x % 4 === 2),
    '▒': (x, y) => (x + y) % 2 === 0,
    '▓': (x, y) => !((y % 2 === 0 && x % 4 === 0) || (y % 2 === 1 && x % 4 === 2)),
    '■': (x, y, h) => x >= 1 && x <= 6 && y >= Math.floor(h * 0.25) && y < Math.ceil(h * 0.75),
    '·': (x, y, h) => (x === 3 || x === 4) && (y === h / 2 - 1 || y === h / 2),
    '→': (x, y, h) => { const c = h / 2 - 0.5, dy = Math.abs(y - c); return (dy <= 0.5 && x <= 6) || (x >= 3 && x <= 6 && dy <= 6.5 - x); },
    '►': (x, y, h) => { const c = (h - 1) / 2; return Math.abs(y - c) <= (h === 16 ? 6 : 3) - x * (h === 16 ? 0.85 : 0.5) && x < 7; },
    '◄': (x, y, h) => { const c = (h - 1) / 2; return Math.abs(y - c) <= (h === 16 ? 6 : 3) - (7 - x) * (h === 16 ? 0.85 : 0.5) && x > 0; },
    '▲': (x, y, h) => { const t = h === 16 ? 4 : 1, b = h === 16 ? 11 : 6; return y >= t && y <= b && Math.abs(x - 3.5) <= (y - t) * 4 / (b - t); },
    '▼': (x, y, h) => { const t = h === 16 ? 4 : 1, b = h === 16 ? 11 : 6; return y >= t && y <= b && Math.abs(x - 3.5) <= (b - y) * 4 / (b - t); },
    '♥': (x, y, h) => { const yy = h === 16 ? Math.floor((y - 3) / 1.5) : y; const rows = [0x66, 0xFF, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00]; return yy >= 0 && yy < 8 && (rows[yy] & (0x80 >> x)); },
    '°': (x, y, h) => { const yy = h === 16 ? Math.floor(y / 2) : y; return [0x38, 0x6C, 0x38][yy] & (0x80 >> x); }
  };
  // 控制字符 0x1A（^Z）显示为右箭头，与 CP437 一致
  const ALIAS = { '\x1A': '→', '→': '→' };

  const cache8 = new Map();
  const cache16 = new Map();

  /** 未知字符的占位字形（空心小方框） */
  function fallback(h) {
    return fnGlyph(h, (x, y) => {
      const t = h === 16 ? 3 : 1, b = h === 16 ? 12 : 6;
      return y >= t && y <= b && x >= 1 && x <= 6 && (y === t || y === b || x === 1 || x === 6);
    });
  }

  function build(ch, h) {
    const code = ch.charCodeAt(0);
    if (ALIAS[ch]) ch = ALIAS[ch];
    if (code >= 32 && code <= 126) {
      const hex = ASCII[code - 32];
      const g8 = new Uint8Array(8);
      for (let i = 0; i < 8; i++) g8[i] = rev(parseInt(hex.substr(i * 2, 2), 16));
      if (h === 8) return g8;
      // 行 0–6 加倍占 14 行，第 7 行（下划线/下伸部）只占 1 行，最后留 1 行行距
      const g16 = new Uint8Array(16);
      for (let i = 0; i < 7; i++) { g16[i * 2] = g8[i]; g16[i * 2 + 1] = g8[i]; }
      g16[14] = g8[7];
      return g16;
    }
    if (code < 32 && !ALIAS[String.fromCharCode(code)]) return new Uint8Array(h);
    if (BOX[ch]) return boxGlyph(BOX[ch], h);
    if (SPECIAL[ch]) return fnGlyph(h, SPECIAL[ch]);
    return fallback(h);
  }

  const Font = {
    /**
     * 取得 8×8 字形（MSB-left，每行一个字节）。
     * @param {number} code 字符编码（UTF-16 码元）
     * @returns {Uint8Array}
     */
    glyph8(code) {
      let g = cache8.get(code);
      if (!g) { g = build(String.fromCharCode(code), 8); cache8.set(code, g); }
      return g;
    },
    /**
     * 取得 8×16 字形（文本模式使用）。
     * @param {number} code
     * @returns {Uint8Array}
     */
    glyph16(code) {
      let g = cache16.get(code);
      if (!g) { g = build(String.fromCharCode(code), 16); cache16.set(code, g); }
      return g;
    },
    /**
     * 是否为需要把第 8 列延伸到第 9 列的制表/方块字形（VGA 行为）。
     * @param {number} code
     * @returns {boolean}
     */
    extendsRight(code) {
      const ch = String.fromCharCode(code);
      return !!(BOX[ch] || '█▀▄░▒▓'.includes(ch));
    }
  };

  DOS.Font = Font;
})(typeof globalThis !== 'undefined' ? globalThis : this);
