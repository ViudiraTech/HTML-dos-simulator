/*
 * Input —— 键盘事件、按键状态、行编辑器与命令历史
 * ---------------------------------------------------------------
 * 所有按键先规范化为 {key, code, ctrl, alt, shift, char} 事件放入队列；
 * readKey() 取一个事件，readLine() 在此之上实现 DOS/DOSKEY 风格的行编辑。
 * 图形程序模式（mode = 'program'）下维护 keysDown 集合供按键状态查询。
 * Ctrl+C 不进入普通队列：立即触发 onBreak，并以 {key:'Break'} 事件唤醒等待者。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  /** 行编辑相关的非字符键 */
  const EDIT_KEYS = new Set([
    'Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'Insert', 'Escape', 'Tab', 'F1', 'F3', 'F6', 'PageUp', 'PageDown'
  ]);
  /** 程序模式下需要阻止浏览器默认行为（滚动等）的按键 */
  const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab', 'Backspace', 'Escape']);

  class Input {
    /**
     * @param {{term: object}} opts term 为 DOS.Terminal
     */
    constructor(opts = {}) {
      this.term = opts.term || null;
      this.queue = [];
      this.waiters = [];
      this.keysDown = new Set();
      /** 'shell' | 'program' */
      this.mode = 'shell';
      this.history = [];
      this.historyLimit = 100;
      this.insertMode = true;
      this.maxLine = 127;
      this.lastLine = '';
      /** @type {null|function(string, boolean):string[]} Tab 补全回调 */
      this.completer = null;
      /** @type {null|function():void} Ctrl+C 回调 */
      this.onBreak = null;
      /** @type {null|function(object, Event):boolean} 全局热键（返回 true 表示已处理） */
      this.onGlobalKey = null;
      /** @type {null|function():void} 每次按键（解锁音频等） */
      this.onAnyKey = null;
      /** @type {null|function():void} 响铃 */
      this.onBell = null;
    }

    /**
     * 绑定到 DOM。
     * @param {EventTarget} target 通常为 window
     */
    attach(target) {
      target.addEventListener('keydown', e => this._onKeyDown(e));
      target.addEventListener('keyup', e => this._onKeyUp(e));
      target.addEventListener('blur', () => this.keysDown.clear());
      target.addEventListener('paste', e => {
        const text = (e.clipboardData || root.clipboardData).getData('text');
        if (text && this.mode === 'shell') {
          e.preventDefault();
          for (const ch of text.replace(/\r\n?/g, '\n')) this.push(ch === '\n' ? Input.key('Enter') : Input.char(ch));
        }
      });
    }

    /** 规范化 DOM 键盘事件 */
    static normalize(e) {
      const char = e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : '';
      return { key: e.key, code: e.code, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, char };
    }

    /** 构造字符事件 */
    static char(ch) { return { key: ch, code: '', ctrl: false, alt: false, shift: false, char: ch }; }

    /** 构造功能键事件 */
    static key(name, mods = {}) {
      return { key: name, code: mods.code || name, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift, char: '' };
    }

    _onKeyUp(e) { this.keysDown.delete(e.code); }

    _onKeyDown(e) {
      // 手机软键盘/输入法：字符经由 keyCode 229 / "Unidentified" 送达，交给 attachTextProxy 的 input 事件处理
      if (e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process') return;
      const ev = Input.normalize(e);
      if (this.onAnyKey) this.onAnyKey();
      if (this.onGlobalKey && this.onGlobalKey(ev, e)) { e.preventDefault(); return; }
      const k = (e.key || '').toLowerCase();
      if (ev.ctrl && (k === 'c' || e.key === 'Pause' || e.key === 'Cancel')) {
        e.preventDefault();
        this.triggerBreak();
        return;
      }
      if (this.mode === 'program') {
        if (!e.repeat) this.keysDown.add(e.code);
        if (GAME_KEYS.has(e.code) || GAME_KEYS.has(e.key) || e.key.length === 1 || /^F\d+$/.test(e.key)) e.preventDefault();
        if (this.queue.length < 32) this.push(ev);
        return;
      }
      this.keysDown.add(e.code);
      if (ev.ctrl && (k === 'v' || k === 'x' || k === 'a')) return; // 交给浏览器（粘贴）
      if (ev.ctrl && k === 'z') { e.preventDefault(); this.push(Input.char('\x1A')); return; }
      if (ev.ctrl && !ev.alt) { if (k === 'l') { e.preventDefault(); this.push(Input.key('ClearScreen')); } return; }
      if (ev.char || EDIT_KEYS.has(e.key)) {
        e.preventDefault();
        if (this.queue.length >= 16 && !this.waiters.length) { if (this.onBell) this.onBell(); return; }
        this.push(ev);
      }
    }

    /**
     * 虚拟按键（屏幕按钮、手柄）：构造与真实键盘相同的事件，走完全相同的处理路径。
     * @param {string} code KeyboardEvent.code，如 'ArrowLeft'、'Space'、'KeyC'
     * @param {string} key  KeyboardEvent.key，如 'ArrowLeft'、' '、'c'
     * @param {boolean} down true = 按下，false = 松开
     * @param {{ctrl?:boolean, shift?:boolean}} [mods]
     */
    virtualKey(code, key, down, mods = {}) {
      const e = {
        code, key, ctrlKey: !!mods.ctrl, metaKey: false, altKey: false, shiftKey: !!mods.shift,
        repeat: false, keyCode: 0, isComposing: false, preventDefault() {}
      };
      if (down) this._onKeyDown(e); else this._onKeyUp(e);
    }

    /**
     * 让一个（不可见的）textarea 承接手机软键盘输入。
     * 软键盘常以 input / composition 事件而不是 keydown 送出字符，这里把它们翻译成按键事件。
     * @param {HTMLTextAreaElement} el
     */
    attachTextProxy(el) {
      const flushText = (text) => {
        if (this.onAnyKey) this.onAnyKey();
        for (const ch of text.replace(/\r\n?/g, '\n')) {
          if (ch === '\n') this.push(Input.key('Enter'));
          else if (this.mode === 'shell') this.push(Input.char(ch));
        }
      };
      // 保留一个哨兵空格：部分 Android 键盘在输入框为空时不会发出退格事件
      const SENT = ' ';
      const reset = () => { el.value = SENT; try { el.setSelectionRange(1, 1); } catch (e) { /* 未聚焦 */ } };
      reset();
      el.addEventListener('focus', reset);
      let composing = false;
      el.addEventListener('compositionstart', () => { composing = true; });
      el.addEventListener('compositionend', (e) => { composing = false; flushText(e.data || ''); reset(); });
      el.addEventListener('beforeinput', (e) => {
        if (composing || e.isComposing) return;
        const t = e.inputType;
        if (t === 'deleteContentBackward') { e.preventDefault(); this.push(Input.key('Backspace')); }
        else if (t === 'deleteContentForward') { e.preventDefault(); this.push(Input.key('Delete')); }
        else if (t === 'insertLineBreak' || t === 'insertParagraph') { e.preventDefault(); this.push(Input.key('Enter')); }
        else if (t === 'insertText' && e.data) { e.preventDefault(); flushText(e.data); }
      });
      // 不支持 beforeinput 取消的浏览器：在 input 事件里兜底读取
      el.addEventListener('input', (e) => {
        if (composing || e.isComposing) return;
        const v = el.value;
        if (!v.startsWith(SENT)) this.push(Input.key('Backspace')); // 哨兵被删掉 = 退格
        else if (v.length > 1) flushText(v.slice(1));
        reset();
      });
    }

    /** 触发 Ctrl+C 中断 */
    triggerBreak() {
      if (this.onBreak) this.onBreak();
      this.push(Input.key('Break'));
    }

    /** 放入事件（若有等待者直接交付） */
    push(ev) {
      if (this.waiters.length) this.waiters.shift()(ev);
      else this.queue.push(ev);
    }

    /**
     * 读取下一个按键事件。
     * @param {number} [timeoutMs] 超时（毫秒），超时返回 null
     * @returns {Promise<object|null>}
     */
    readKey(timeoutMs) {
      if (this.queue.length) return Promise.resolve(this.queue.shift());
      return new Promise(resolve => {
        let tid = null;
        const w = (ev) => { if (tid) clearTimeout(tid); resolve(ev); };
        this.waiters.push(w);
        if (timeoutMs > 0) {
          tid = setTimeout(() => {
            const i = this.waiters.indexOf(w);
            if (i >= 0) this.waiters.splice(i, 1);
            resolve(null);
          }, timeoutMs);
        }
      });
    }

    /** 非阻塞读取 @returns {object|null} */
    pollKey() { return this.queue.length ? this.queue.shift() : null; }

    /** 清空键盘缓冲 */
    flush() { this.queue.length = 0; }

    /**
     * 测试辅助：注入按键。字符串中 {Name} 表示功能键，如 "DIR{Enter}"。
     * @param {...(string|object)} items
     */
    feed(...items) {
      for (const it of items) {
        if (typeof it !== 'string') { this.push(it); continue; }
        const re = /\{([A-Za-z0-9+]+)\}|([\s\S])/g;
        let m;
        while ((m = re.exec(it))) {
          if (m[1]) {
            const parts = m[1].split('+');
            const name = parts.pop();
            const mods = { ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
            if (mods.ctrl && name.toLowerCase() === 'c') this.triggerBreak();
            else this.push(Input.key(name, mods));
          } else this.push(Input.char(m[2]));
        }
      }
    }

    /** 查询按键是否按下（KeyboardEvent.code） */
    isDown(code) { return this.keysDown.has(code); }

    /** 历史记录追加 */
    addHistory(line) {
      if (!line.trim()) return;
      if (this.history[this.history.length - 1] !== line) this.history.push(line);
      if (this.history.length > this.historyLimit) this.history.shift();
    }

    /**
     * 读取一行（行编辑器）。
     * @param {{history?:boolean, complete?:boolean, maxLength?:number}} [opts]
     * @returns {Promise<string|null>} Ctrl+C 时返回 null
     */
    async readLine(opts = {}) {
      const t = this.term;
      const useHistory = opts.history !== false;
      const max = opts.maxLength || this.maxLine;
      const ed = { buf: [], pos: 0, sx: t.x, sy: t.y, prevLen: 0 };
      let histIdx = this.history.length;
      let comp = null;
      const template = this.lastLine;
      t.cursorShape = this.insertMode ? 'block' : 'underline';

      const posOf = (i) => {
        const abs = ed.sx + i;
        return { x: abs % t.cols, y: ed.sy + Math.floor(abs / t.cols) };
      };
      const ensureRow = (row) => {
        if (row >= t.rows) {
          const n = row - t.rows + 1;
          t.scrollUp(n);
          ed.sy -= n;
        }
      };
      const redraw = () => {
        const n = Math.max(ed.buf.length, ed.prevLen);
        ensureRow(posOf(Math.max(n, ed.pos)).y);
        for (let i = 0; i < n; i++) {
          const p = posOf(i);
          const ch = i < ed.buf.length ? ed.buf[i] : ' ';
          t.setCell(p.x, p.y, ch.charCodeAt(0), t.attr);
        }
        ed.prevLen = ed.buf.length;
        const c = posOf(ed.pos);
        ensureRow(c.y);
        const c2 = posOf(ed.pos);
        t.x = c2.x; t.y = c2.y;
        t.dirty = true;
      };
      const setText = (s) => { ed.buf = Array.from(s.slice(0, max)); ed.pos = ed.buf.length; };
      const insert = (ch) => {
        if (this.insertMode || ed.pos >= ed.buf.length) {
          if (ed.buf.length >= max) { if (this.onBell) this.onBell(); return; }
          ed.buf.splice(ed.pos, 0, ch);
        } else ed.buf[ed.pos] = ch;
        ed.pos++;
      };

      for (;;) {
        const ev = await this.readKey();
        t.resetView();
        if (ev.key !== 'Tab') comp = null;
        switch (ev.key) {
          case 'Break':
            ed.pos = ed.buf.length; redraw();
            t.write('^C\n');
            return null;
          case 'Enter': {
            ed.pos = ed.buf.length; redraw();
            const line = ed.buf.join('');
            const end = posOf(ed.buf.length);
            t.x = end.x; t.y = end.y;
            t.write('\n');
            if (useHistory) { this.addHistory(line); this.lastLine = line; }
            return line;
          }
          case 'Backspace':
            if (ed.pos > 0) { ed.buf.splice(ed.pos - 1, 1); ed.pos--; }
            break;
          case 'Delete':
            if (ed.pos < ed.buf.length) ed.buf.splice(ed.pos, 1);
            break;
          case 'ArrowLeft':
            if (ev.ctrl) { while (ed.pos > 0 && ed.buf[ed.pos - 1] === ' ') ed.pos--; while (ed.pos > 0 && ed.buf[ed.pos - 1] !== ' ') ed.pos--; }
            else if (ed.pos > 0) ed.pos--;
            break;
          case 'ArrowRight':
            if (ev.ctrl) { while (ed.pos < ed.buf.length && ed.buf[ed.pos] !== ' ') ed.pos++; while (ed.pos < ed.buf.length && ed.buf[ed.pos] === ' ') ed.pos++; }
            else if (ed.pos < ed.buf.length) ed.pos++;
            else if (ed.pos < template.length) insert(template[ed.pos]); // 与 DOS 一致：→ 在行尾复制模板字符
            break;
          case 'Home': ed.pos = 0; break;
          case 'End': ed.pos = ed.buf.length; break;
          case 'Insert':
            this.insertMode = !this.insertMode;
            t.cursorShape = this.insertMode ? 'block' : 'underline';
            break;
          case 'Escape': ed.buf = []; ed.pos = 0; break;
          case 'ArrowUp':
            if (useHistory && this.history.length) { histIdx = Math.max(0, histIdx - 1); setText(this.history[histIdx]); }
            break;
          case 'ArrowDown':
            if (useHistory && this.history.length) {
              histIdx = Math.min(this.history.length, histIdx + 1);
              setText(histIdx >= this.history.length ? '' : this.history[histIdx]);
            }
            break;
          case 'F1':
            if (ed.pos < template.length) {
              if (ed.pos < ed.buf.length) ed.buf[ed.pos] = template[ed.pos];
              else ed.buf.push(template[ed.pos]);
              ed.pos++;
            }
            break;
          case 'F3':
            for (let i = ed.pos; i < template.length && i < max; i++) {
              if (i < ed.buf.length) ed.buf[i] = template[i]; else ed.buf.push(template[i]);
            }
            ed.pos = ed.buf.length;
            break;
          case 'F6': insert('\x1A'); break;
          case 'ClearScreen': {
            const text = ed.buf.join(''), pos = ed.pos;
            t.clear();
            if (opts.redrawPrompt) opts.redrawPrompt();
            ed.sx = t.x; ed.sy = t.y; ed.prevLen = 0; ed.buf = Array.from(text); ed.pos = pos;
            break;
          }
          case 'Tab': {
            if (opts.complete === false || !this.completer) { insert(' '); break; }
            if (!comp) {
              let start = ed.pos;
              while (start > 0 && ed.buf[start - 1] !== ' ') start--;
              const token = ed.buf.slice(start, ed.pos).join('');
              const first = ed.buf.slice(0, start).join('').trim() === '';
              const list = this.completer(token, first) || [];
              if (!list.length) { if (this.onBell) this.onBell(); break; }
              comp = { start, end: ed.pos, list, idx: ev.shift ? 0 : -1 };
            }
            const n = comp.list.length;
            comp.idx = ((comp.idx + (ev.shift ? -1 : 1)) % n + n) % n;
            const item = Array.from(comp.list[comp.idx]);
            if (comp.start + item.length + (ed.buf.length - comp.end) > max) break;
            ed.buf.splice(comp.start, comp.end - comp.start, ...item);
            comp.end = comp.start + item.length;
            ed.pos = comp.end;
            break;
          }
          default:
            if (ev.char) insert(ev.char);
        }
        redraw();
      }
    }
  }

  DOS.Input = Input;
})(typeof globalThis !== 'undefined' ? globalThis : this);
