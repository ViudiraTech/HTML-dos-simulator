/*
 * Parser —— 命令行与批处理语法解析（纯函数，无副作用）
 * ---------------------------------------------------------------
 * - splitCommand：COMMAND.COM 风格的命令名切分（CD.. / ECHO. / DIR/W）
 * - parseArgs：参数与开关（/W、/A:H、/-Y）
 * - expandVars：%VAR%、批处理参数 %0-%9、%*、%%
 * - parsePipeline：管道 | 与重定向 > >> <
 * - parseIf / parseFor：IF 与 FOR 语句
 * - expandPrompt：PROMPT 的 $ 代码
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  class SyntaxError_ extends Error {
    constructor(msg) { super(msg || 'Syntax error'); this.code = 'SYNTAX'; }
  }

  const Parser = {
    SyntaxError: SyntaxError_,

    /**
     * 按空白切分，双引号内的空白保留；返回去掉引号的 token。
     * @param {string} s
     * @param {{keepQuotes?:boolean}} [opts]
     * @returns {string[]}
     */
    tokenize(s, opts = {}) {
      const out = [];
      let cur = '', inQ = false, has = false;
      for (const ch of String(s)) {
        if (ch === '"') { inQ = !inQ; has = true; if (opts.keepQuotes) cur += ch; continue; }
        if (!inQ && /[\s,;=]/.test(ch) && !opts.keepDelims) {
          if (has) { out.push(cur); cur = ''; has = false; }
          continue;
        }
        cur += ch; has = true;
      }
      if (has) out.push(cur);
      return out;
    },

    /**
     * 切分命令名与剩余部分。
     * @param {string} line 已去掉前导空白的命令行
     * @param {function(string):boolean} isInternal 判断是否为内部命令
     * @returns {{name:string, rest:string, internal:boolean}}
     */
    splitCommand(line, isInternal) {
      const m = /^("[^"]*"|[^\s/]+)(.*)$/s.exec(line);
      if (!m) return { name: '', rest: '', internal: false };
      const token = m[1].replace(/"/g, '');
      const rest = m[2];
      const up = token.toUpperCase();
      if (isInternal(up)) return { name: up, rest, internal: true };
      const mm = /^([A-Za-z]+)([.\\:;,=+[\]].*)$/s.exec(token);
      if (mm && isInternal(mm[1].toUpperCase()) && !/^\.(COM|EXE|BAT)$/i.test(mm[2])) {
        return { name: mm[1].toUpperCase(), rest: mm[2] + rest, internal: true };
      }
      return { name: token, rest, internal: false };
    },

    /**
     * 解析参数与开关。"/A:H" → switches.A = 'H'；"/W" → switches.W = ''；"/-Y" → switches['-Y'] = ''。
     * @param {string} rest
     * @returns {{params:string[], switches:Object<string,string>, order:string[]}}
     */
    parseArgs(rest) {
      const params = [], switches = {}, order = [];
      for (const tok of Parser.tokenize(rest, { keepQuotes: true })) {
        // 在引号外按 / 切分
        const pieces = [];
        let cur = '', inQ = false;
        for (const ch of tok) {
          if (ch === '"') inQ = !inQ;
          if (ch === '/' && !inQ) { pieces.push(cur); cur = '/'; continue; }
          cur += ch;
        }
        pieces.push(cur);
        for (const p of pieces) {
          if (!p) continue;
          if (p[0] === '/') {
            let body = p.slice(1);
            if (!body) continue;
            let key = body[0].toUpperCase();
            body = body.slice(1);
            if (key === '-' && body) { key = '-' + body[0].toUpperCase(); body = body.slice(1); }
            switches[key] = body.replace(/^:/, '').toUpperCase();
            order.push(key);
          } else params.push(p.replace(/"/g, ''));
        }
      }
      return { params, switches, order };
    },

    /**
     * 变量展开。
     * @param {string} line
     * @param {function(string):(string|undefined)} getEnv 名称已大写
     * @param {string[]|null} batchArgs 批处理参数（含 %0）；命令行时为 null
     * @returns {string}
     */
    expandVars(line, getEnv, batchArgs) {
      const batch = Array.isArray(batchArgs);
      let out = '';
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch !== '%') { out += ch; continue; }
        const next = line[i + 1];
        if (batch) {
          if (next === '%') { out += '%'; i++; continue; }
          if (next !== undefined && next >= '0' && next <= '9') { out += batchArgs[+next] || ''; i++; continue; }
          if (next === '*') { out += batchArgs.slice(1).join(' '); i++; continue; }
        }
        const j = line.indexOf('%', i + 1);
        if (j > i + 1) {
          const name = line.slice(i + 1, j);
          if (/^[^\s%=]+$/.test(name)) {
            const v = getEnv(name.toUpperCase());
            if (v !== undefined) { out += v; i = j; continue; }
            if (batch) { i = j; continue; }
          }
        }
        if (!batch) out += '%';
      }
      return out;
    },

    /**
     * 解析管道与重定向。
     * @param {string} line
     * @returns {{line:string, input:string|null, output:string|null, append:boolean}[]}
     */
    parsePipeline(line) {
      const segs = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        if (ch === '|' && !inQ) { segs.push(cur); cur = ''; continue; }
        cur += ch;
      }
      segs.push(cur);
      return segs.map(seg => {
        let input = null, output = null, append = false, text = '';
        let i = 0, q = false;
        const readTarget = () => {
          while (i < seg.length && /\s/.test(seg[i])) i++;
          let t = '';
          if (seg[i] === '"') { i++; while (i < seg.length && seg[i] !== '"') t += seg[i++]; i++; }
          else while (i < seg.length && !/[\s<>|]/.test(seg[i])) t += seg[i++];
          return t;
        };
        while (i < seg.length) {
          const ch = seg[i];
          if (ch === '"') q = !q;
          if (!q && ch === '>') {
            append = seg[i + 1] === '>';
            i += append ? 2 : 1;
            output = readTarget();
            if (!output) throw new SyntaxError_('Syntax error');
            continue;
          }
          if (!q && ch === '<') { i++; input = readTarget(); if (!input) throw new SyntaxError_('Syntax error'); continue; }
          text += ch; i++;
        }
        return { line: text.trim(), input, output, append };
      });
    },

    /** 读取一个 IF 操作数（支持双引号） */
    _operand(s) {
      s = s.replace(/^\s+/, '');
      if (s[0] === '"') {
        const j = s.indexOf('"', 1);
        if (j < 0) return { value: s, rest: '' };
        return { value: s.slice(0, j + 1), rest: s.slice(j + 1) };
      }
      const m = /^([^\s=]*)(.*)$/s.exec(s);
      return { value: m[1], rest: m[2] };
    },

    /**
     * 解析 IF 语句（不含 IF 关键字）。
     * @param {string} text
     * @returns {{not:boolean, type:'errorlevel'|'exist'|'compare', level?:number, path?:string, a?:string, b?:string, ignoreCase?:boolean, command:string}}
     */
    parseIf(text) {
      let s = text.replace(/^\s+/, '');
      let ignoreCase = false, not = false;
      if (/^\/I\s+/i.test(s)) { ignoreCase = true; s = s.replace(/^\/I\s+/i, ''); }
      if (/^NOT\s+/i.test(s)) { not = true; s = s.replace(/^NOT\s+/i, ''); }
      let m;
      if ((m = /^ERRORLEVEL\s+(\d+)\s+(.+)$/is.exec(s))) return { not, type: 'errorlevel', level: +m[1], command: m[2].trim() };
      if ((m = /^EXIST\s+("[^"]*"|\S+)\s+(.+)$/is.exec(s))) return { not, type: 'exist', path: m[1].replace(/"/g, ''), command: m[2].trim() };
      const a = Parser._operand(s);
      let rest = a.rest.replace(/^\s+/, '');
      if (!rest.startsWith('==')) throw new SyntaxError_('Syntax error');
      const b = Parser._operand(rest.slice(2));
      const command = b.rest.trim();
      if (!command) throw new SyntaxError_('Syntax error');
      return { not, type: 'compare', a: a.value, b: b.value, ignoreCase, command };
    },

    /**
     * 解析 FOR 语句（不含 FOR 关键字）：%A IN (set) DO command
     * @param {string} text
     * @returns {{variable:string, items:string[], command:string}}
     */
    parseFor(text) {
      const m = /^\s*%([A-Za-z0-9])\s+IN\s*\(([^)]*)\)\s*DO\s+(.+)$/is.exec(text);
      if (!m) throw new SyntaxError_('Syntax error');
      const items = m[2].split(/[\s,;]+/).filter(Boolean);
      return { variable: m[1], items, command: m[3] };
    },

    /** 字符串是否包含通配符 */
    hasWildcard(s) { return /[*?]/.test(s); },

    /**
     * 展开 PROMPT 代码。
     * @param {string} fmt
     * @param {{cwd:string, drive:string, version:string, date:string, time:string}} info
     * @returns {string}
     */
    expandPrompt(fmt, info) {
      let out = '';
      for (let i = 0; i < fmt.length; i++) {
        if (fmt[i] !== '$') { out += fmt[i]; continue; }
        const c = (fmt[++i] || '').toUpperCase();
        switch (c) {
          case 'P': out += info.cwd; break;
          case 'G': out += '>'; break;
          case 'L': out += '<'; break;
          case 'B': out += '|'; break;
          case 'Q': out += '='; break;
          case 'N': out += info.drive; break;
          case '_': out += '\n'; break;
          case '$': out += '$'; break;
          case 'T': out += info.time; break;
          case 'D': out += info.date; break;
          case 'V': out += info.version; break;
          case 'H': out = out.slice(0, -1); break;
          case 'E': break; // ANSI 转义：不支持，忽略
          default: break;
        }
      }
      return out;
    }
  };

  DOS.Parser = Parser;
})(typeof globalThis !== 'undefined' ? globalThis : this);
