/*
 * Machine —— 集中保存全部可变状态，并负责命令执行管线与外壳循环
 * ---------------------------------------------------------------
 * 状态：终端、输入、文件系统、图形、音频、环境变量、ERRORLEVEL、ECHO、
 *       批处理栈、中断标志、显示模式、输出重定向栈、设置（主题/CRT）。
 * 执行顺序：变量展开 → 管道/重定向 → 盘符切换 → 内部命令 →
 *           外部命令（当前目录 → PATH，依次尝试 .COM .EXE .BAT）。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  /** Ctrl+C 中断 */
  class BreakError extends Error {
    constructor() { super('Break'); this.code = 'BREAK'; }
  }

  const SETTINGS_KEY = 'htmldos.settings';

  class Machine {
    /**
     * @param {{storage?:object, headless?:boolean}} [opts]
     */
    constructor(opts = {}) {
      this.storage = opts.storage || null;
      this.headless = !!opts.headless;
      this.version = '6.22';
      this.settings = Object.assign({ theme: 'classic', crt: true, dateOffset: 0 }, this._loadSettings());
      this.dateOffset = this.settings.dateOffset || 0;
      this.term = new DOS.Terminal({ cols: 80, rows: 25, scrollback: 1000 });
      this.input = new DOS.Input({ term: this.term });
      this.fs = new DOS.FileSystem({ storage: this.storage, clock: () => this.now().getTime() });
      this.gfx = new DOS.Graphics();
      this.audio = DOS.Audio;
      this.env = new Map([
        ['COMSPEC', 'C:\\COMMAND.COM'],
        ['PATH', 'C:\\;C:\\UTILS;C:\\GAMES;C:\\MARIO'],
        ['PROMPT', '$P$G']
      ]);
      this.errorLevel = 0;
      this.echo = true;
      this.batchStack = [];
      this.breakFlag = false;
      /** 'text' | 'gfxconsole' | 'gfx' */
      this.display = 'text';
      this.savedText = null;
      this.outStack = [];
      this.stdin = null;
      this.programRunning = false;
      this.booting = false;
      /** 回调（由 main.js 设置） */
      this.onDisplayChange = null;
      this.onSettingsChange = null;
      this.onAnnounce = null;

      this.input.onBreak = () => { this.breakFlag = true; };
      this.input.completer = (tok, first) => this.complete(tok, first);
      this.input.onBell = () => this.bell();
      this.term.onBell = () => this.bell();
    }

    // ---------------- 设置 ----------------

    _loadSettings() {
      if (!this.storage) return {};
      try { return JSON.parse(this.storage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
    }

    /** 保存设置到 storage */
    saveSettings() {
      this.settings.dateOffset = this.dateOffset;
      if (!this.storage) return;
      try { this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* 忽略 */ }
    }

    /** 修改设置并通知界面 */
    updateSettings(patch) {
      Object.assign(this.settings, patch);
      this.saveSettings();
      if (this.onSettingsChange) this.onSettingsChange(this.settings);
    }

    // ---------------- 基础服务 ----------------

    /** 当前（可被 DATE/TIME 调整的）时间 */
    now() { return new Date(Date.now() + this.dateOffset); }

    /** 读取环境变量（名称大写） */
    getEnv(name) { return this.env.get(String(name).toUpperCase()); }

    /** 设置或删除环境变量 */
    setEnv(name, value) {
      name = String(name).toUpperCase();
      if (value === '' || value === undefined || value === null) this.env.delete(name);
      else this.env.set(name, value);
    }

    /** 响铃 */
    bell() { if (this.audio) this.audio.beep(880, 80); }

    /** 输出到当前标准输出（终端或重定向缓冲） */
    out(str) {
      if (this.outStack.length) this.outStack[this.outStack.length - 1].text += str;
      else this.term.write(str);
    }

    /** 输出一行 */
    outln(str = '') { this.out(str + '\n'); }

    /** 是否处于重定向中 */
    get redirected() { return this.outStack.length > 0; }

    /** 若已按下 Ctrl+C 则抛出 BreakError */
    checkBreak() { if (this.breakFlag) throw new BreakError(); }

    /** 读取一个按键（Ctrl+C 抛出 BreakError） */
    async readKey(timeoutMs) {
      const ev = await this.input.readKey(timeoutMs);
      if (ev && ev.key === 'Break') { this.breakFlag = true; throw new BreakError(); }
      return ev;
    }

    /** 读取一行（无历史；Ctrl+C 抛出 BreakError） */
    async readLine() {
      const s = await this.input.readLine({ history: false, complete: false });
      if (s === null) { this.breakFlag = true; throw new BreakError(); }
      return s;
    }

    /** 让出事件循环（无 4ms 节流） */
    yieldNow() {
      return new Promise(resolve => {
        if (typeof setImmediate === 'function') setImmediate(resolve);
        else if (typeof MessageChannel !== 'undefined') {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
          ch.port2.postMessage(0);
        } else setTimeout(resolve, 0);
      });
    }

    /** 延时 */
    sleep(ms) { return new Promise(r => setTimeout(r, this.headless ? 0 : ms)); }

    /** 无障碍播报 */
    announce(text) { if (this.onAnnounce) this.onAnnounce(text); }

    // ---------------- 提示符与补全 ----------------

    /** 生成提示符字符串 */
    promptString() {
      const d = this.now();
      const pad = (n) => String(n).padStart(2, '0');
      let cwd;
      try { cwd = this.fs.getCwd(); } catch (e) { cwd = this.fs.curDrive + ':'; }
      return DOS.Parser.expandPrompt(this.getEnv('PROMPT') || '$P$G', {
        cwd,
        drive: this.fs.curDrive,
        version: 'MS-DOS Version ' + this.version,
        date: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(Math.floor(d.getMilliseconds() / 10))}`
      });
    }

    /**
     * Tab 补全候选。
     * @param {string} token 光标前的单词
     * @param {boolean} first 是否为命令位置
     * @returns {string[]}
     */
    complete(token, first) {
      const idx = Math.max(token.lastIndexOf('\\'), token.lastIndexOf(':'));
      const dirPart = token.slice(0, idx + 1);
      const prefix = token.slice(idx + 1).toUpperCase();
      const isExec = (n) => /\.(COM|EXE|BAT)$/.test(n);
      const H = DOS.FileSystem.ATTR.H;
      const out = new Set();
      try {
        for (const e of this.fs.list(dirPart || '.')) {
          if (e.attr & H || !e.name.startsWith(prefix)) continue;
          if (first && e.type !== 'dir' && !isExec(e.name)) continue;
          out.add(dirPart + e.name);
        }
      } catch (e) { /* 目录不存在 */ }
      if (first && !dirPart) {
        for (const n of DOS.Commands.names()) if (n.startsWith(prefix)) out.add(n);
        for (const dir of (this.getEnv('PATH') || '').split(';').filter(Boolean)) {
          try {
            for (const e of this.fs.list(dir)) if (e.type === 'file' && isExec(e.name) && e.name.startsWith(prefix)) out.add(e.name.replace(/\.[A-Z]+$/, ''));
          } catch (e) { /* 忽略无效 PATH 项 */ }
        }
      }
      return Array.from(out).sort();
    }

    // ---------------- 执行管线 ----------------

    /**
     * 执行一行命令。
     * @param {string} rawLine
     * @param {{expanded?:boolean, call?:boolean, batch?:object}} [opts]
     */
    async execute(rawLine, opts = {}) {
      let line = opts.expanded ? rawLine : DOS.Parser.expandVars(rawLine, n => this.getEnv(n), null);
      line = line.replace(/^\s+/, '');
      if (line[0] === '@') line = line.slice(1).replace(/^\s+/, '');
      if (!line.trim()) return;
      if (/^REM(\s|$)/i.test(line) || line[0] === ':') return;
      let segs;
      try { segs = DOS.Parser.parsePipeline(line); } catch (e) { this.outln('Syntax error'); return; }
      let pipeText = null;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const last = i === segs.length - 1;
        let stdin = i > 0 ? pipeText : null;
        if (seg.input) {
          try { stdin = this.fs.readText(seg.input); } catch (e) { this.outln('File not found'); return; }
        }
        const capture = !last || !!seg.output;
        if (capture) this.outStack.push({ text: '' });
        const prevStdin = this.stdin;
        this.stdin = stdin;
        let captured = '';
        try {
          await this.dispatch(seg.line, opts);
        } finally {
          this.stdin = prevStdin;
          if (capture) captured = this.outStack.pop().text;
        }
        if (seg.output) {
          const target = seg.output.toUpperCase();
          if (target === 'CON') this.out(captured);
          else if (target !== 'NUL' && target !== 'PRN') {
            try { this.fs.writeText(seg.output, captured, { append: seg.append }); }
            catch (e) { if (e instanceof DOS.FsError) this.outln(e.code === 'DISK_FULL' ? 'Insufficient disk space' : 'File creation error'); else throw e; }
          }
          captured = '';
        }
        pipeText = captured;
      }
    }

    /** 分派单个命令（无管道） */
    async dispatch(line, opts = {}) {
      line = line.trim();
      if (!line) return;
      if (/^[A-Za-z]:$/.test(line)) {
        try { this.fs.setDrive(line[0]); } catch (e) { this.outln('Invalid drive specification'); }
        return;
      }
      const sp = DOS.Parser.splitCommand(line, n => DOS.Commands.has(n));
      if (sp.internal) return this.runInternal(sp.name, sp.rest, opts);
      return this.runExternal(sp.name, sp.rest, opts);
    }

    /** 命令帮助文本 */
    helpText(def) { return typeof def.help === 'function' ? def.help() : def.help; }

    /** 运行内部命令 */
    async runInternal(name, rest, opts = {}) {
      const def = DOS.Commands.get(name);
      const args = DOS.Parser.parseArgs(rest);
      const wantsHelp = def.raw ? rest.trim() === '/?' : args.switches['?'] !== undefined;
      if (wantsHelp) { this.outln(this.helpText(def)); return; }
      await def.run({ m: this, name, raw: rest, params: args.params, switches: args.switches, opts });
    }

    /**
     * 查找外部命令：当前目录 → PATH，依次尝试 .COM .EXE .BAT。
     * @returns {{path:string, ext:string}|null}
     */
    findExecutable(name) {
      const up = name.toUpperCase().replace(/"/g, '');
      const base = up.split(/[\\:]/).pop();
      const em = /\.([^.]*)$/.exec(base);
      const exts = ['COM', 'EXE', 'BAT'];
      if (em && !exts.includes(em[1])) return null;
      const candidates = em ? [up] : exts.map(e => up + '.' + e);
      const dirs = /[\\:]/.test(up) ? [''] : [''].concat((this.getEnv('PATH') || '').split(';').filter(Boolean));
      for (const dir of dirs) {
        for (const cand of candidates) {
          const p = dir ? dir.replace(/\\$/, '') + '\\' + cand : cand;
          const s = this.fs.stat(p);
          if (s && s.type === 'file') return { path: s.path, ext: s.name.split('.').pop() };
        }
      }
      return null;
    }

    /** 运行外部命令（.BAT 或带签名的 .COM/.EXE） */
    async runExternal(name, rest, opts = {}) {
      const found = this.findExecutable(name);
      if (!found) { this.outln('Bad command or file name'); return; }
      const params = DOS.Parser.tokenize(rest, { keepQuotes: true });
      if (found.ext === 'BAT') {
        await DOS.Batch.run(this, found.path, [name].concat(params), { call: !!opts.call });
        return;
      }
      const id = DOS.DiskImage.programId(this.fs.readBytes(found.path));
      const prog = id && DOS.Programs.get(id);
      if (!prog) { this.outln('Program too big to fit in memory'); return; }
      const args = DOS.Parser.parseArgs(rest);
      await this.runProgram(prog, rest, args.params, args.switches);
    }

    /**
     * 运行已注册的外部程序。
     * @param {object} prog Programs 注册项
     */
    async runProgram(prog, raw = '', params = [], switches = {}) {
      if (switches['?'] !== undefined && prog.help) { this.outln(prog.help); return; }
      this.programRunning = true;
      this.input.flush();
      try {
        const code = await prog.run(this, { raw, params, switches });
        this.errorLevel = typeof code === 'number' ? code : 0;
      } finally {
        this.programRunning = false;
        if (this.display === 'gfx') this.leaveGraphics();
      }
    }

    // ---------------- 显示模式 ----------------

    _notifyDisplay() { if (this.onDisplayChange) this.onDisplayChange(this.display); }

    /**
     * 进入图形模式（供程序调用）。保存当前文本屏幕以便退出时恢复。
     * @param {number} [w] 宽度，默认 320
     * @param {number} [h] 高度，默认 200
     */
    enterGraphics(w = 320, h = 200) {
      if (this.display === 'text') this.savedText = this.term.snapshot();
      this.display = 'gfx';
      this.gfx.setResolution(w, h);
      this.gfx.resetPalette();
      this.gfx.clear(0);
      this.gfx.swap();
      this.input.mode = 'program';
      this.input.flush();
      this.input.keysDown.clear();
      this._notifyDisplay();
    }

    /** 离开图形模式，回到 80×25 文本模式并恢复原屏幕内容 */
    leaveGraphics() {
      this.input.mode = 'shell';
      this.input.keysDown.clear();
      this.input.flush();
      this.display = 'text';
      this.gfx.resetPalette();
      if (this.savedText) { this.term.restore(this.savedText); this.savedText = null; }
      if (this.term.cols !== 80 || this.term.rows !== 25) this.term.resize(80, 25);
      this.term.cursorVisible = true;
      this.term.dirty = true;
      this._notifyDisplay();
    }

    /**
     * MODE 命令：0x13 = 320×200 图形控制台（40×25 文本），3 = 80×25 文本。
     * @param {number} mode
     */
    setVideoMode(mode) {
      if (mode === 0x13) {
        if (this.display === 'text') this.savedText = this.term.snapshot();
        this.display = 'gfxconsole';
        this.gfx.setResolution(320, 200);
        this.gfx.resetPalette();
        this.gfx.clear(0);
        this.term.resize(40, 25);
      } else {
        this.display = 'text';
        this.savedText = null;
        this.term.resize(80, 25);
      }
      this._notifyDisplay();
    }

    // ---------------- 外壳循环 ----------------

    /** 交互式执行一行（捕获中断与内部错误） */
    async runInteractive(line) {
      try {
        await this.execute(line);
      } catch (e) {
        this.handleError(e);
      } finally {
        this.outStack.length = 0;
        this.stdin = null;
        if (this.display === 'gfx') this.leaveGraphics();
        this.input.mode = 'shell';
      }
    }

    /** 错误处理：Ctrl+C 打印 ^C；其他错误打印内部错误 */
    handleError(e) {
      this.outStack.length = 0;
      if (e instanceof BreakError) {
        this.term.ensureLineStart();
        this.term.write('^C\n');
        this.batchStack.length = 0;
        this.echo = true;
      } else {
        if (typeof console !== 'undefined') console.error(e);
        this.term.ensureLineStart();
        this.term.writeln('Internal error: ' + (e && e.message));
      }
      this.breakFlag = false;
      this.input.flush();
    }

    /** 命令提示符循环（永不返回） */
    async shell() {
      for (;;) {
        this.breakFlag = false;
        this.term.ensureLineStart();
        this.term.write(this.promptString());
        const line = await this.input.readLine({ redrawPrompt: () => this.term.write(this.promptString()) });
        if (line === null || !line.trim()) { this.breakFlag = false; continue; }
        await this.runInteractive(line);
        this.term.ensureLineStart();
        this.term.write('\n');
      }
    }

    /** 等待（Esc 时提前结束） */
    async _postDelay(ms, state) {
      const end = Date.now() + ms;
      while (!state.skip && Date.now() < end) {
        if (this.input.queue.some(e => e.key === 'Escape')) { state.skip = true; break; }
        await new Promise(r => setTimeout(r, Math.min(20, end - Date.now())));
      }
    }

    /** 模拟 BIOS 自检画面（Esc 跳过） */
    async post() {
      const t = this.term;
      const state = { skip: false };
      this.booting = true; // 触屏界面据此把“点按屏幕”当作 Esc（跳过自检）
      t.clear();
      t.cursorVisible = false;
      const now = this.now();
      t.attr = 0x0F; t.write(' WebBIOS (C) 2026 HTML-DOS Project'); t.attr = 0x07;
      t.write('\n Version 1.00  80486DX2 compatible\n\n');
      t.write(' Main Processor : 80486DX2-66MHz (emulated in JavaScript)\n');
      t.write(' Memory Testing :       ');
      const mx = t.x, my = t.y;
      for (let k = 0; k <= 16384; k += 256) {
        t.gotoXY(mx, my); t.write(String(k).padStart(6) + 'K');
        await this._postDelay(12, state);
        if (state.skip) { t.gotoXY(mx, my); t.write(' 16384K'); break; }
      }
      t.write(' OK\n\n');
      const items = [
        ' Detecting Primary Master  ... HTMLDISK-512 (C:)',
        ' Detecting Primary Slave   ... None',
        ' Floppy Drive A:           ... 1.44M, 3.5 in.',
        ' Display Adapter           ... VGA/EGA compatible',
        ' Sound                     ... Web Audio (PC speaker emulation)'
      ];
      for (const s of items) { t.write(s + '\n'); await this._postDelay(160, state); }
      t.write('\n');
      const box = [
        '╔════════════════════════════════════════════════════════════════════╗',
        '║  CPU Type    : 80486DX2       Base Memory     :    640K             ║',
        '║  Co-Processor: Installed      Extended Memory :  15360K             ║',
        '║  CPU Clock   : 66MHz          Cache Memory    :    256K             ║',
        '╟────────────────────────────────────────────────────────────────────╢',
        '║  Diskette A  : 1.44M, 3.5 in. Display Type    : VGA/EGA             ║',
        '║  Hard Disk C : 512MB          Serial Port(s)  : 3F8 2F8             ║',
        '╚════════════════════════════════════════════════════════════════════╝'
      ];
      t.attr = 0x0B;
      for (const s of box) t.write(' ' + s.replace('╟', '╠').replace('╢', '╣') + '\n');
      t.attr = 0x07;
      t.gotoXY(0, 23);
      t.write(` ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}-i486-HTMLDOS-1.00     Press ESC to skip, DEL to enter SETUP`);
      await this._postDelay(900, state);
      this.booting = false;
      this.input.flush();
      t.cursorVisible = true;
    }

    /**
     * 启动：BIOS 自检 → "Starting MS-DOS..." → AUTOEXEC.BAT → 命令提示符。
     * @param {{skipPost?:boolean}} [opts]
     */
    async boot(opts = {}) {
      if (!opts.skipPost) await this.post();
      this.term.attr = 0x07;
      this.term.clear();
      this.term.write('Starting MS-DOS...\n\n');
      await this.sleep(opts.skipPost ? 0 : 400);
      this.input.flush();
      if (this.fs.isFile('C:\\AUTOEXEC.BAT')) {
        try { await DOS.Batch.run(this, 'C:\\AUTOEXEC.BAT', ['C:\\AUTOEXEC.BAT']); }
        catch (e) { this.handleError(e); }
      }
      this.echo = true;
      this.term.ensureLineStart();
      this.term.write('\n');
      return this.shell();
    }
  }

  DOS.Machine = Machine;
  DOS.BreakError = BreakError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
