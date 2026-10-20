/*
 * Commands —— 表驱动的内置命令注册表
 * ---------------------------------------------------------------
 * 每条命令是一个对象：
 *   { name, aliases?, summary, help, raw?, run: async (c) => {} }
 * c = { m, name, raw, params, switches(sw), opts }
 * 新增命令只需调用 Commands.register({...})。
 * raw = true 的命令只在参数恰好为 "/?" 时显示帮助（ECHO、SET 等需要原样参数）。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const registry = new Map();
  const ordered = [];

  const Commands = {
    /** 注册命令 @param {object} def */
    register(def) {
      ordered.push(def);
      registry.set(def.name, def);
      for (const a of def.aliases || []) registry.set(a, def);
    },
    /** 是否为内部命令 */
    has(name) { return registry.has(String(name).toUpperCase()); },
    /** 取命令定义 */
    get(name) { return registry.get(String(name).toUpperCase()) || null; },
    /** 全部命令（注册顺序） */
    list() { return ordered.slice(); },
    /** 全部命令名（含别名） */
    names() { return Array.from(registry.keys()); }
  };

  // ------------------------------------------------------------------
  // 工具函数
  // ------------------------------------------------------------------

  const ATTR = () => DOS.FileSystem.ATTR;
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const pad2 = (n) => String(n).padStart(2, '0');

  /** MM-DD-YY */
  function fmtDate(ms) { const d = new Date(ms); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getFullYear() % 100)}`; }
  /** h:mma */
  function fmtTime(ms) {
    const d = new Date(ms);
    let h = d.getHours();
    const ap = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return `${h}:${pad2(d.getMinutes())}${ap}`;
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** 打印文件系统错误；非 FsError 继续抛出 */
  function fsErr(m, e, override) {
    if (!(e instanceof DOS.FsError)) throw e;
    const msg = (override && override[e.code]) || DOS.FileSystem.MESSAGES[e.code] || e.message;
    m.outln(msg);
  }

  /** 8.3 名称拆分 */
  function splitName(name) {
    const i = name.lastIndexOf('.');
    return i <= 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
  }

  /** 通配符模板改名：REN *.TXT *.BAK */
  function applyTemplate(name, pattern) {
    const [nb, ne] = splitName(name.toUpperCase());
    const [pb, pe] = pattern.toUpperCase().includes('.') ? splitName(pattern.toUpperCase()) : [pattern.toUpperCase(), ''];
    const part = (src, pat) => {
      let out = '';
      for (let i = 0; i < pat.length; i++) {
        const ch = pat[i];
        if (ch === '*') { out += src.slice(i); break; }
        if (ch === '?') { if (i < src.length) out += src[i]; }
        else out += ch;
      }
      return out;
    };
    const b = part(nb, pb), e = part(ne, pe);
    return e ? b + '.' + e : b;
  }

  /** 是否路径表示目录（已存在的目录、以 \ 结尾或只有盘符） */
  function targetIsDir(fs, dest) {
    if (/^[A-Za-z]:$/.test(dest) || /\\$/.test(dest)) return true;
    return fs.isDir(dest);
  }

  function joinPath(dir, name) { return dir.replace(/\\$/, '') + '\\' + name; }

  /** 可显示文本：^Z 截断，控制字符替换为空格 */
  function printable(text) {
    const z = text.indexOf('\x1A');
    if (z >= 0) text = text.slice(0, z);
    return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x06\x0B-\x1F\x7F]/g, ' ').replace(/\x07/g, ' ');
  }

  /** 分页输出器 */
  function pager(m, enabled, prompt = 'Press any key to continue . . .', after = '') {
    let lines = 0;
    const per = m.term.rows - 1;
    return async (line = '') => {
      m.outln(line);
      if (!enabled || m.redirected) return;
      lines += Math.max(1, Math.ceil(line.length / m.term.cols));
      if (lines >= per) {
        m.term.write(prompt);
        await m.readKey();
        m.term.write('\r' + ' '.repeat(Math.min(prompt.length, m.term.cols - 1)) + '\r');
        if (after) m.term.write(after + '\n');
        lines = after ? 1 : 0;
      }
    };
  }

  /** Y/N 询问（单键） */
  async function ask(m, q, letters = 'YN') {
    m.term.write(q);
    for (;;) {
      const ev = await m.readKey();
      const c = (ev.char || '').toUpperCase();
      if (letters.includes(c) && c) { m.term.write(c + '\n'); return c; }
      if (ev.key === 'Enter' && letters.includes('\n')) { m.term.write('\n'); return '\n'; }
    }
  }

  /** 读取 stdin 或文件参数 */
  function readInput(c, files) {
    const m = c.m;
    if (files.length) return files.map(f => ({ name: f, text: m.fs.readText(f) }));
    if (m.stdin !== null && m.stdin !== undefined) return [{ name: null, text: m.stdin }];
    return null;
  }

  function attrFilter(spec) {
    // spec 如 "H"、"-D"、"DH"
    const A = ATTR();
    const conds = [];
    for (let i = 0; i < spec.length; i++) {
      let neg = false;
      if (spec[i] === '-') { neg = true; i++; }
      const bit = A[spec[i]];
      if (bit) conds.push(e => !!(e.attr & bit) !== neg);
    }
    return e => conds.every(f => f(e));
  }

  // ------------------------------------------------------------------
  // 文件类命令
  // ------------------------------------------------------------------

  Commands.register({
    name: 'DIR',
    summary: 'Displays a list of files and subdirectories in a directory.',
    help: [
      'Displays a list of files and subdirectories in a directory.',
      '',
      'DIR [drive:][path][filename] [/P] [/W] [/A[[:]attributes]] [/O[[:]sortorder]] [/S] [/B]',
      '',
      '  /P      Pauses after each screenful of information.',
      '  /W      Uses wide list format.',
      '  /A      Displays files with specified attributes (D H S R A, prefix - for "not").',
      '  /O      List by files in sorted order (N name, E extension, S size, D date, G dirs first).',
      '  /S      Displays files in specified directory and all subdirectories.',
      '  /B      Uses bare format (no heading information or summary).',
      '',
      'Wildcards * and ? are supported, e.g. DIR *.TXT or DIR C:\\GAMES\\B?LL.*'
    ].join('\n'),
    async run(c) {
      const m = c.m, fs = m.fs, sw = c.switches;
      const spec = c.params[0] || '';
      let g;
      try { g = fs.glob(spec || '.'); } catch (e) { return fsErr(m, e, { PATH_NOT_FOUND: 'File not found', INVALID_DRIVE: 'Invalid drive specification' }); }
      const out = pager(m, sw.P !== undefined, 'Press any key to continue . . .', `(continuing ${fs.format(g.dir)})`);
      const A = ATTR();
      const filt = sw.A === undefined ? (e => !(e.attr & (A.H | A.S))) : attrFilter(sw.A);
      const sortSpec = sw.O === undefined ? null : (sw.O || 'GN');
      const sortEntries = (list) => {
        if (!sortSpec) return list;
        const keys = [];
        for (let i = 0; i < sortSpec.length; i++) {
          let rev = false;
          if (sortSpec[i] === '-') { rev = true; i++; }
          keys.push({ k: sortSpec[i], rev });
        }
        return list.slice().sort((a, b) => {
          for (const { k, rev } of keys) {
            let d = 0;
            if (k === 'N') d = a.name.localeCompare(b.name);
            else if (k === 'E') d = splitName(a.name)[1].localeCompare(splitName(b.name)[1]);
            else if (k === 'S') d = a.size - b.size;
            else if (k === 'D') d = a.mtime - b.mtime;
            else if (k === 'G') d = (b.type === 'dir') - (a.type === 'dir');
            if (d) return rev ? -d : d;
          }
          return 0;
        });
      };
      const line = (e) => {
        if (sw.B !== undefined) return e.name;
        const [b, x] = e.name === '.' || e.name === '..' ? [e.name, ''] : splitName(e.name);
        const mid = e.type === 'dir' ? '    <DIR>     ' : num(e.size).padStart(14);
        return `${b.padEnd(8)} ${x.padEnd(3)}${mid} ${fmtDate(e.mtime)}  ${fmtTime(e.mtime).padStart(6)}`;
      };
      let totalFiles = 0, totalBytes = 0, anyFound = false;
      const drive = fs.drives[g.dir.drive];
      if (sw.B === undefined) {
        await out(drive.label ? ` Volume in drive ${drive.letter} is ${drive.label}` : ` Volume in drive ${drive.letter} has no label`);
        await out(` Volume Serial Number is ${drive.serial}`);
      }
      const listDir = async (dirLoc, pattern, first) => {
        let entries;
        try { entries = fs.list(dirLoc).filter(e => DOS.FileSystem.wildMatch(e.name, pattern)); } catch (e) { return; }
        const allPattern = pattern === '*.*' || pattern === '*';
        if (allPattern && dirLoc.parts.length && sw.B === undefined) {
          const self = fs.stat(dirLoc);
          entries.unshift({ type: 'dir', name: '..', attr: A.D, mtime: self.mtime, size: 0 }, { type: 'dir', name: '.', attr: A.D, mtime: self.mtime, size: 0 });
          [entries[0], entries[1]] = [entries[1], entries[0]];
        }
        entries = sortEntries(entries.filter(filt));
        if (entries.length || first) {
          if (entries.length) anyFound = true;
          if (sw.B === undefined && entries.length) { await out(` Directory of ${fs.format(dirLoc)}`); await out(''); }
          let files = 0, bytes = 0, dirs = 0;
          if (sw.W !== undefined && sw.B === undefined) {
            let row = '';
            const perRow = Math.max(1, Math.floor(m.term.cols / 16));
            let n = 0;
            for (const e of entries) {
              const label = e.type === 'dir' ? `[${e.name}]` : e.name;
              row += label.padEnd(16);
              if (++n % perRow === 0) { await out(row.trimEnd()); row = ''; }
            }
            if (row) await out(row.trimEnd());
            for (const e of entries) { if (e.type === 'dir') dirs++; else { files++; bytes += e.size; } }
          } else {
            for (const e of entries) {
              await out(sw.B !== undefined && sw.S !== undefined ? joinPath(fs.format(dirLoc), e.name) : line(e));
              if (e.type === 'dir') dirs++; else { files++; bytes += e.size; }
              m.checkBreak();
            }
          }
          totalFiles += files; totalBytes += bytes;
          if (sw.B === undefined && entries.length) {
            await out(`${String(files).padStart(9)} file(s)${num(bytes).padStart(15)} bytes`);
            if (sw.S === undefined) await out(`${String(dirs).padStart(9)} dir(s) ${num(fs.usage(g.dir.drive).free).padStart(15)} bytes free`);
            else await out('');
          }
        }
        if (sw.S !== undefined) {
          for (const e of fs.list(dirLoc)) {
            if (e.type === 'dir') await listDir({ drive: dirLoc.drive, parts: dirLoc.parts.concat(e.name) }, pattern, false);
          }
        }
      };
      await listDir(g.dir, g.pattern, true);
      if (!anyFound) {
        if (sw.B === undefined) { await out(''); await out('File not found'); }
        return;
      }
      if (sw.S !== undefined && sw.B === undefined) {
        await out('Total files listed:');
        await out(`${String(totalFiles).padStart(9)} file(s)${num(totalBytes).padStart(15)} bytes`);
        await out(`${' '.repeat(18)}${num(fs.usage(g.dir.drive).free).padStart(15)} bytes free`);
      }
    }
  });

  Commands.register({
    name: 'CD',
    aliases: ['CHDIR'],
    summary: 'Displays the name of or changes the current directory.',
    help: 'Displays the name of or changes the current directory.\n\nCHDIR [drive:][path]\nCHDIR[..]\nCD [drive:][path]\nCD[..]\n\n  ..   Specifies that you want to change to the parent directory.\n\nType CD drive: to display the current directory in the specified drive.\nType CD without parameters to display the current drive and directory.',
    async run(c) {
      const m = c.m, fs = m.fs;
      const p = c.params[0];
      if (!p) { m.outln(fs.getCwd()); return; }
      if (/^[A-Za-z]:$/.test(p)) {
        try { m.outln(fs.getCwd(p[0].toUpperCase())); } catch (e) { fsErr(m, e); }
        return;
      }
      try { fs.chdir(p); } catch (e) { fsErr(m, e, { NOT_DIR: 'Invalid directory', PATH_NOT_FOUND: 'Invalid directory' }); }
    }
  });

  Commands.register({
    name: 'MD',
    aliases: ['MKDIR'],
    summary: 'Creates a directory.',
    help: 'Creates a directory.\n\nMKDIR [drive:]path\nMD [drive:]path',
    async run(c) {
      const m = c.m;
      if (!c.params.length) { m.outln('Required parameter missing'); return; }
      for (const p of c.params) {
        try { m.fs.mkdir(p); } catch (e) { fsErr(m, e, { EXISTS: 'Unable to create directory', INVALID_NAME: 'Unable to create directory', PATH_NOT_FOUND: 'Unable to create directory' }); }
      }
    }
  });

  Commands.register({
    name: 'RD',
    aliases: ['RMDIR'],
    summary: 'Removes (deletes) a directory.',
    help: 'Removes (deletes) a directory.\n\nRMDIR [drive:]path [/S] [/Q]\nRD [drive:]path [/S] [/Q]\n\n  /S   Removes all files and subdirectories in the directory as well.\n  /Q   Quiet mode, do not ask if ok to remove a directory tree with /S.',
    async run(c) {
      const m = c.m, fs = m.fs;
      if (!c.params.length) { m.outln('Required parameter missing'); return; }
      const recursive = c.switches.S !== undefined;
      for (const p of c.params) {
        if (recursive && c.switches.Q === undefined && fs.isDir(p)) {
          const ans = await ask(m, `${fs.stat(p).path}, Are you sure (Y/N)? `);
          if (ans !== 'Y') continue;
        }
        try { fs.rmdir(p, { recursive }); } catch (e) { fsErr(m, e); }
      }
    }
  });

  Commands.register({
    name: 'TYPE',
    summary: 'Displays the contents of a text file.',
    help: 'Displays the contents of a text file.\n\nTYPE [drive:][path]filename',
    async run(c) {
      const m = c.m, fs = m.fs;
      if (!c.params.length) { m.outln('Required parameter missing'); return; }
      for (const p of c.params) {
        let g;
        try { g = fs.glob(p); } catch (e) { m.outln(`File not found - ${p.toUpperCase()}`); continue; }
        const files = DOS.Parser.hasWildcard(p) || fs.isDir(p) ? g.entries.filter(e => e.type === 'file') : g.entries.filter(e => e.type === 'file' && fs.isFile(p));
        if (!files.length) { m.outln(fs.isDir(p) ? 'Access denied' : `File not found - ${p.toUpperCase()}`); continue; }
        for (const e of files) {
          const path = joinPath(fs.format(g.dir), e.name);
          if (files.length > 1) m.outln('\n' + path + '\n');
          const text = printable(fs.readText(path));
          m.out(text);
          m.checkBreak();
        }
      }
    }
  });

  /** COPY CON：读取键盘输入直到 ^Z（F6 或 Ctrl+Z） */
  async function copyCon(m, dest) {
    const lines = [];
    for (;;) {
      const line = await m.input.readLine({ history: false, complete: false, maxLength: 127 });
      if (line === null) { return; }
      const z = line.indexOf('\x1A');
      if (z >= 0) { if (z > 0) lines.push(line.slice(0, z)); break; }
      lines.push(line);
    }
    try {
      m.fs.writeText(dest, lines.join('\n') + (lines.length ? '\n' : ''));
      m.outln('        1 file(s) copied');
    } catch (e) { fsErr(m, e); m.outln('        0 file(s) copied'); }
  }

  Commands.register({
    name: 'COPY',
    summary: 'Copies one or more files to another location.',
    help: 'Copies one or more files to another location.\n\nCOPY [/Y|/-Y] source [+ source [+ ...]] [destination]\nCOPY CON filename\n\n  source       Specifies the file or files to be copied (wildcards allowed).\n  destination  Specifies the directory and/or filename for the new file(s).\n  /Y           Suppresses prompting to confirm you want to overwrite an\n               existing destination file.\n  /-Y          Causes prompting to confirm you want to overwrite an\n               existing destination file.\n\nUse COPY CON filename to type a file; finish with F6 or Ctrl+Z, then Enter.',
    async run(c) {
      const m = c.m, fs = m.fs;
      // 把 "a + b" 合并为一个源
      const params = [];
      for (const p of DOS.Parser.parseArgs(c.raw.replace(/\s*\+\s*/g, '+')).params) params.push(p);
      if (!params.length) { m.outln('Required parameter missing'); return; }
      const src = params[0];
      const dest = params[1] || '.';
      if (src.toUpperCase() === 'CON') {
        if (!params[1]) { m.outln('Required parameter missing'); return; }
        return copyCon(m, dest);
      }
      const noPrompt = c.switches.Y !== undefined || (c.opts.batch && c.switches['-Y'] === undefined);
      // 收集源文件
      const sources = [];
      for (const part of src.split('+').filter(Boolean)) {
        let g;
        try { g = fs.glob(part); } catch (e) { fsErr(m, e); m.outln('        0 file(s) copied'); return; }
        const files = g.entries.filter(e => e.type === 'file' && !(e.attr & ATTR().H));
        if (!DOS.Parser.hasWildcard(part) && !fs.isDir(part) && !fs.isFile(part)) {
          m.outln(`File not found - ${part.toUpperCase()}`); m.outln('        0 file(s) copied'); return;
        }
        for (const e of files) sources.push(joinPath(fs.format(g.dir), e.name));
      }
      if (!sources.length) { m.outln(`File not found - ${src.toUpperCase()}`); m.outln('        0 file(s) copied'); return; }
      const destUp = dest.toUpperCase();
      if (destUp === 'CON' || destUp === 'NUL' || destUp === 'PRN') {
        for (const s of sources) { if (destUp === 'CON') m.out(printable(fs.readText(s))); }
        m.outln(`        ${sources.length} file(s) copied`);
        return;
      }
      const concat = src.includes('+') || (sources.length > 1 && !targetIsDir(fs, dest) && !DOS.Parser.hasWildcard(dest));
      let all = noPrompt, copied = 0;
      const confirm = async (target) => {
        if (all || !fs.exists(target)) return true;
        const a = await ask(m, `Overwrite ${fs.stat(target).path} (Yes/No/All)? `, 'YNA');
        if (a === 'A') all = true;
        return a !== 'N';
      };
      if (concat) {
        const target = targetIsDir(fs, dest) ? joinPath(dest, splitName(fs.stat(sources[0]).name).join('.').replace(/\.$/, '')) : dest;
        const text = sources.map(s => fs.readText(s)).join('');
        if (!(await confirm(target))) { m.outln('        0 file(s) copied'); return; }
        try { fs.writeText(target, text); copied = 1; for (const s of sources) m.outln(fs.stat(s).path); } catch (e) { fsErr(m, e); }
        m.outln(`        ${copied} file(s) copied`);
        return;
      }
      const showNames = sources.length > 1 || DOS.Parser.hasWildcard(src);
      for (const s of sources) {
        const name = fs.stat(s).name;
        let target;
        if (targetIsDir(fs, dest)) target = joinPath(fs.format(fs.resolve(dest)), name);
        else if (DOS.Parser.hasWildcard(dest)) {
          const dl = fs.resolve(dest);
          target = joinPath(fs.format({ drive: dl.drive, parts: dl.parts.slice(0, -1) }), applyTemplate(name, dl.parts[dl.parts.length - 1]));
        } else target = dest;
        const tStat = fs.stat(target);
        if (tStat && tStat.path === fs.stat(s).path) { m.outln('File cannot be copied onto itself'); continue; }
        if (!(await confirm(target))) continue;
        try {
          fs.copyFile(s, target);
          copied++;
          if (showNames) m.outln(fs.stat(s).path);
        } catch (e) { fsErr(m, e); break; }
        m.checkBreak();
      }
      m.outln(`        ${copied} file(s) copied`);
    }
  });

  Commands.register({
    name: 'DEL',
    aliases: ['ERASE'],
    summary: 'Deletes one or more files.',
    help: 'Deletes one or more files.\n\nDEL [drive:][path]filename [/P]\nERASE [drive:][path]filename [/P]\n\n  [drive:][path]filename  Specifies the file(s) to delete. Wildcards allowed.\n  /P                      Prompts for confirmation before deleting each file.',
    async run(c) {
      const m = c.m, fs = m.fs;
      if (!c.params.length) { m.outln('Required parameter missing'); return; }
      for (const p of c.params) {
        let g;
        try { g = fs.glob(p); } catch (e) { fsErr(m, e); continue; }
        const isAll = g.pattern === '*.*' || g.pattern === '*' || fs.isDir(p);
        const files = g.entries.filter(e => e.type === 'file' && !(e.attr & (ATTR().H | ATTR().S)));
        if (!DOS.Parser.hasWildcard(p) && !fs.isDir(p) && !fs.isFile(p)) { m.outln('File not found'); continue; }
        if (!files.length) { m.outln('File not found'); continue; }
        if (isAll && c.switches.P === undefined) {
          m.term.write('All files in directory will be deleted!\n');
          if ((await ask(m, 'Are you sure (Y/N)? ')) !== 'Y') continue;
        }
        let denied = false;
        for (const e of files) {
          const path = joinPath(fs.format(g.dir), e.name);
          if (c.switches.P !== undefined && (await ask(m, `${path},    Delete (Y/N)? `)) !== 'Y') continue;
          try { fs.unlink(path); } catch (err) { if (err.code === 'ACCESS_DENIED') denied = true; else fsErr(m, err); }
        }
        if (denied) m.outln('Access denied');
      }
    }
  });

  Commands.register({
    name: 'REN',
    aliases: ['RENAME'],
    summary: 'Renames a file or files.',
    help: 'Renames a file or files.\n\nRENAME [drive:][path]filename1 filename2\nREN [drive:][path]filename1 filename2\n\nNote that you cannot specify a new drive or path for your destination file.\nWildcards are allowed, e.g. REN *.TXT *.BAK',
    async run(c) {
      const m = c.m, fs = m.fs;
      if (c.params.length < 2) { m.outln('Required parameter missing'); return; }
      const [src, dst] = c.params;
      if (/[\\:]/.test(dst)) { m.outln('Invalid parameter'); return; }
      let g;
      try { g = fs.glob(src); } catch (e) { m.outln('Duplicate file name or file not found'); return; }
      let entries = g.entries;
      if (!DOS.Parser.hasWildcard(src)) entries = fs.exists(src) ? [fs.stat(src)] : [];
      if (!entries.length) { m.outln('Duplicate file name or file not found'); return; }
      for (const e of entries) {
        const path = DOS.Parser.hasWildcard(src) ? joinPath(fs.format(g.dir), e.name) : fs.stat(src).path;
        try { fs.rename(path, applyTemplate(e.name, dst)); }
        catch (err) { if (err instanceof DOS.FsError) m.outln('Duplicate file name or file not found'); else throw err; }
      }
    }
  });

  Commands.register({
    name: 'MOVE',
    summary: 'Moves files and renames files and directories.',
    help: 'Moves files and renames files and directories.\n\nTo move one or more files:\nMOVE [/Y | /-Y] [drive:][path]filename1[,...] destination\n\nTo rename a directory:\nMOVE [drive:][path]dirname1 dirname2\n\n  /Y   Suppresses prompting to confirm overwriting of the destination.\n  /-Y  Causes prompting to confirm overwriting of the destination.',
    async run(c) {
      const m = c.m, fs = m.fs;
      if (c.params.length < 2) { m.outln('Required parameter missing'); return; }
      const dest = c.params[c.params.length - 1];
      const noPrompt = c.switches.Y !== undefined || (c.opts.batch && c.switches['-Y'] === undefined);
      const sources = [];
      for (const s of c.params.slice(0, -1)) {
        if (DOS.Parser.hasWildcard(s)) {
          let g;
          try { g = fs.glob(s); } catch (e) { fsErr(m, e); return; }
          for (const e of g.entries.filter(x => x.type === 'file')) sources.push(joinPath(fs.format(g.dir), e.name));
        } else if (fs.exists(s)) sources.push(fs.stat(s).path);
        else { m.outln(`File not found - ${s.toUpperCase()}`); }
      }
      if (!sources.length) return;
      const toDir = targetIsDir(fs, dest);
      if (sources.length > 1 && !toDir) { m.outln('Cannot move multiple files to a single file'); return; }
      let all = noPrompt;
      for (const s of sources) {
        const st = fs.stat(s);
        const target = toDir ? joinPath(fs.format(fs.resolve(dest)), st.name) : fs.format(fs.resolve(dest));
        if (fs.exists(target) && fs.stat(target).path !== st.path && st.type === 'file' && !all) {
          const a = await ask(m, `Overwrite ${target} (Yes/No/All)? `, 'YNA');
          if (a === 'N') continue;
          if (a === 'A') all = true;
        }
        try {
          if (fs.isFile(target) && fs.stat(target).path !== st.path) fs.unlink(target);
          fs.move(s, target);
          m.outln(`${st.path} => ${target} [ok]`);
        } catch (e) {
          if (!(e instanceof DOS.FsError)) throw e;
          m.outln(`${st.path} => ${target} [${(DOS.FileSystem.MESSAGES[e.code] || e.message).replace(/\n/g, ' ')}]`);
        }
      }
    }
  });

  Commands.register({
    name: 'ATTRIB',
    summary: 'Displays or changes file attributes.',
    help: 'Displays or changes file attributes.\n\nATTRIB [+R | -R] [+A | -A] [+S | -S] [+H | -H] [[drive:][path]filename] [/S]\n\n  +   Sets an attribute.\n  -   Clears an attribute.\n  R   Read-only file attribute.\n  A   Archive file attribute.\n  S   System file attribute.\n  H   Hidden file attribute.\n  /S  Processes files in all directories in the specified path.',
    async run(c) {
      const m = c.m, fs = m.fs, A = ATTR();
      const changes = {};
      const specs = [];
      for (const t of DOS.Parser.tokenize(c.raw)) {
        if (/^\/S$/i.test(t)) continue;
        const mm = /^([+-])([RASH])$/i.exec(t);
        if (mm) changes[mm[2].toUpperCase()] = mm[1] === '+';
        else if (/^[+-]/.test(t)) { m.outln(`Invalid switch - ${t}`); return; }
        else specs.push(t);
      }
      if (!specs.length) specs.push('*.*');
      const recurse = c.switches.S !== undefined;
      let found = false;
      const visit = (dirLoc, pattern) => {
        for (const e of fs.list(dirLoc)) {
          const path = joinPath(fs.format(dirLoc), e.name);
          if (e.type === 'file' && DOS.FileSystem.wildMatch(e.name, pattern)) {
            found = true;
            if (Object.keys(changes).length) fs.setAttr(path, changes);
            else {
              const a = fs.stat(path).attr;
              m.outln(`  ${a & A.A ? 'A' : ' '}  ${a & A.S ? 'S' : ' '}${a & A.H ? 'H' : ' '}${a & A.R ? 'R' : ' '}     ${path}`);
            }
          }
          if (recurse && e.type === 'dir') visit({ drive: dirLoc.drive, parts: dirLoc.parts.concat(e.name) }, pattern);
        }
      };
      for (const s of specs) {
        try {
          const g = fs.glob(s);
          if (!DOS.Parser.hasWildcard(s) && fs.isFile(s)) visit(g.dir, fs.stat(s).name);
          else visit(g.dir, g.pattern);
        } catch (e) { fsErr(m, e); return; }
      }
      if (!found) m.outln(`File not found - ${specs[0].toUpperCase()}`);
    }
  });

  Commands.register({
    name: 'TREE',
    summary: 'Graphically displays the directory structure of a drive or path.',
    help: 'Graphically displays the directory structure of a drive or path.\n\nTREE [drive:][path] [/F] [/A]\n\n  /F   Displays the names of the files in each directory.\n  /A   Uses ASCII instead of extended characters.',
    async run(c) {
      const m = c.m, fs = m.fs;
      const ascii = c.switches.A !== undefined, files = c.switches.F !== undefined;
      const G = ascii ? { tee: '+---', last: '\\---', bar: '|   ' } : { tee: '├───', last: '└───', bar: '│   ' };
      const p = c.params[0] || '.';
      let loc;
      try { loc = fs.resolve(p); } catch (e) { return fsErr(m, e); }
      if (!fs.isDir(fs.format(loc))) { m.outln(`Invalid path - ${p.toUpperCase()}`); return; }
      const drive = fs.drives[loc.drive];
      m.outln(`Directory PATH listing for Volume ${drive.label || 'NO NAME'}`);
      m.outln(`Volume Serial Number is ${drive.serial}`);
      m.outln(c.params[0] ? fs.format(loc) : `${loc.drive}:.`);
      let anyDir = false;
      const walk = (dirLoc, prefix) => {
        const list = fs.list(dirLoc).filter(e => !(e.attr & ATTR().H));
        const dirs = list.filter(e => e.type === 'dir');
        if (files) {
          const fl = list.filter(e => e.type === 'file');
          for (const f of fl) m.outln(prefix + (dirs.length ? G.bar : '    ') + f.name);
          if (fl.length) m.outln((prefix + (dirs.length ? G.bar : '')).trimEnd() || '');
        }
        dirs.forEach((d, i) => {
          anyDir = true;
          const last = i === dirs.length - 1;
          m.outln(prefix + (last ? G.last : G.tee) + d.name);
          walk({ drive: dirLoc.drive, parts: dirLoc.parts.concat(d.name) }, prefix + (last ? '    ' : G.bar));
        });
      };
      walk(loc, '');
      if (!anyDir) m.outln('No subfolders exist');
    }
  });

  Commands.register({
    name: 'FC',
    summary: 'Compares two text files and displays the differences between them.',
    help: 'Compares two text files and displays the differences between them.\n\nFC [/C] [/N] [drive1:][path1]filename1 [drive2:][path2]filename2\n\n  /C   Disregards the case of letters.\n  /N   Displays the line numbers.',
    async run(c) {
      const m = c.m, fs = m.fs;
      if (c.params.length < 2) { m.outln('FC: Insufficient number of file specifications'); m.errorLevel = 2; return; }
      const [f1, f2] = c.params;
      const texts = [];
      for (const f of [f1, f2]) {
        try { texts.push(fs.readText(f)); } catch (e) { m.outln(`FC: cannot open ${f.toUpperCase()} - No such file or directory`); m.errorLevel = 2; return; }
      }
      const n1 = fs.stat(f1).path, n2 = fs.stat(f2).path;
      m.outln(`Comparing files ${n1} and ${n2}`);
      const a = texts[0].replace(/\r/g, '').replace(/\n$/, '').split('\n');
      const b = texts[1].replace(/\r/g, '').replace(/\n$/, '').split('\n');
      const norm = (s) => c.switches.C !== undefined ? s.toUpperCase() : s;
      // LCS 动态规划
      const L = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
        L[i][j] = norm(a[i]) === norm(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
      const hunks = [];
      let i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && norm(a[i]) === norm(b[j])) { i++; j++; continue; }
        const h = { ai: i, bj: j, a: [], b: [] };
        while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && norm(a[i]) === norm(b[j]))) {
          if (j >= b.length || (i < a.length && L[i + 1][j] >= L[i][j + 1])) h.a.push(i++);
          else h.b.push(j++);
        }
        h.resyncA = i < a.length ? i : -1; h.resyncB = j < b.length ? j : -1;
        hunks.push(h);
      }
      if (!hunks.length) { m.outln('FC: no differences encountered'); m.outln(''); m.errorLevel = 0; return; }
      const ln = (k, s) => c.switches.N !== undefined ? `${String(k + 1).padStart(5)}:  ${s}` : s;
      for (const h of hunks) {
        m.outln(`***** ${n1}`);
        if (h.ai > 0) m.outln(ln(h.ai - 1, a[h.ai - 1]));
        for (const k of h.a) m.outln(ln(k, a[k]));
        if (h.resyncA >= 0) m.outln(ln(h.resyncA, a[h.resyncA]));
        m.outln(`***** ${n2}`);
        if (h.bj > 0) m.outln(ln(h.bj - 1, b[h.bj - 1]));
        for (const k of h.b) m.outln(ln(k, b[k]));
        if (h.resyncB >= 0) m.outln(ln(h.resyncB, b[h.resyncB]));
        m.outln('*****');
        m.outln('');
      }
      m.errorLevel = 1;
    }
  });

  // ------------------------------------------------------------------
  // 系统类命令
  // ------------------------------------------------------------------

  Commands.register({
    name: 'ECHO',
    raw: true,
    summary: 'Displays messages, or turns command-echoing on or off.',
    help: 'Displays messages, or turns command-echoing on or off.\n\n  ECHO [ON | OFF]\n  ECHO [message]\n  ECHO.          (prints an empty line)\n\nType ECHO without parameters to display the current echo setting.',
    async run(c) {
      const m = c.m;
      const raw = c.raw;
      if (/^[.:;,=+[\]\\/]/.test(raw)) { m.outln(raw.slice(1)); return; }
      const text = raw.replace(/^\s/, '');
      const t = text.trim().toUpperCase();
      if (!t) { m.outln(`ECHO is ${m.echo ? 'on' : 'off'}`); return; }
      if (t === 'ON') { m.echo = true; return; }
      if (t === 'OFF') { m.echo = false; return; }
      m.outln(text);
    }
  });

  Commands.register({
    name: 'CLS',
    summary: 'Clears the screen.',
    help: 'Clears the screen.\n\nCLS',
    async run(c) { if (!c.m.redirected) c.m.term.clear(); }
  });

  Commands.register({
    name: 'VER',
    summary: 'Displays the MS-DOS version.',
    help: 'Displays the MS-DOS version.\n\nVER',
    async run(c) { c.m.outln(''); c.m.outln(`MS-DOS Version ${c.m.version}`); c.m.outln('(HTML-DOS simulator, pure HTML5/JavaScript)'); }
  });

  Commands.register({
    name: 'VOL',
    summary: 'Displays a disk volume label and serial number.',
    help: 'Displays the disk volume label and serial number, if they exist.\n\nVOL [drive:]',
    async run(c) {
      const m = c.m;
      const letter = (c.params[0] || m.fs.curDrive).replace(':', '').toUpperCase();
      const d = m.fs.drives[letter];
      if (!d) { m.outln('Invalid drive specification'); return; }
      m.outln('');
      m.outln(d.label ? ` Volume in drive ${letter} is ${d.label}` : ` Volume in drive ${letter} has no label`);
      m.outln(` Volume Serial Number is ${d.serial}`);
    }
  });

  /** 解析日期 mm-dd-yy / mm/dd/yyyy @returns {Date|null} */
  function parseDate(s, now) {
    const mm = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s.trim());
    if (!mm) return null;
    let y = +mm[3];
    if (mm[3].length === 2) y += y < 80 ? 2000 : 1900;
    const mo = +mm[1] - 1, d = +mm[2];
    if (y < 1980 || y > 2099) return null;
    const dt = new Date(y, mo, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    if (dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  /** 解析时间 h:mm[:ss[.hh]][a|p] @returns {Date|null} */
  function parseTime(s, now) {
    const mm = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:[.,](\d{1,2}))?\s*([ap])?m?$/i.exec(s.trim());
    if (!mm) return null;
    let h = +mm[1];
    const mi = +(mm[2] || 0), se = +(mm[3] || 0), hs = +(mm[4] || 0);
    if (mm[5]) { const p = mm[5].toLowerCase() === 'p'; if (h > 12 || h === 0) return null; h = (h % 12) + (p ? 12 : 0); }
    if (h > 23 || mi > 59 || se > 59) return null;
    const dt = new Date(now.getTime());
    dt.setHours(h, mi, se, hs * 10);
    return dt;
  }

  function fmtLongTime(d) {
    let h = d.getHours();
    const ap = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return `${String(h).padStart(2)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad2(Math.floor(d.getMilliseconds() / 10))}${ap}`;
  }

  Commands.register({
    name: 'DATE',
    summary: 'Displays or sets the date.',
    help: 'Displays or sets the date.\n\nDATE [date] [/T]\n\n  /T   Displays the date without prompting for a new one.\n\nType DATE without parameters to display the current date setting and\na prompt for a new one. Press ENTER to keep the same date.',
    async run(c) {
      const m = c.m;
      const now = m.now();
      const show = () => `${DAYS[now.getDay()]} ${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${now.getFullYear()}`;
      if (c.switches.T !== undefined) { m.outln(show()); return; }
      const apply = (s) => { const d = parseDate(s, now); if (!d) return false; m.dateOffset += d.getTime() - now.getTime(); m.saveSettings(); return true; };
      if (c.params.length) { if (!apply(c.params.join('-'))) m.outln('Invalid date'); return; }
      m.outln(`Current date is ${show()}`);
      for (;;) {
        m.term.write('Enter new date (mm-dd-yy): ');
        const s = await m.readLine();
        if (!s.trim() || apply(s)) return;
        m.outln('Invalid date');
      }
    }
  });

  Commands.register({
    name: 'TIME',
    summary: 'Displays or sets the system time.',
    help: 'Displays or sets the system time.\n\nTIME [time] [/T]\n\n  /T   Displays the time without prompting for a new one.\n\nType TIME with no parameters to display the current time setting and a\nprompt for a new one. Press ENTER to keep the same time.',
    async run(c) {
      const m = c.m;
      const now = m.now();
      if (c.switches.T !== undefined) { m.outln(fmtLongTime(now).trim()); return; }
      const apply = (s) => { const d = parseTime(s, now); if (!d) return false; m.dateOffset += d.getTime() - now.getTime(); m.saveSettings(); return true; };
      if (c.params.length) { if (!apply(c.params.join(':'))) m.outln('Invalid time'); return; }
      m.outln(`Current time is ${fmtLongTime(now)}`);
      for (;;) {
        m.term.write('Enter new time: ');
        const s = await m.readLine();
        if (!s.trim() || apply(s)) return;
        m.outln('Invalid time');
      }
    }
  });

  Commands.register({
    name: 'SET',
    raw: true,
    summary: 'Displays, sets, or removes MS-DOS environment variables.',
    help: 'Displays, sets, or removes MS-DOS environment variables.\n\nSET [variable=[string]]\n\n  variable  Specifies the environment-variable name.\n  string    Specifies a series of characters to assign to the variable.\n\nType SET without parameters to display the current environment variables.\nUse %VARIABLE% on the command line or in batch files to expand a value.',
    async run(c) {
      const m = c.m;
      const raw = c.raw.replace(/^\s+/, '');
      if (!raw) { for (const [k, v] of m.env) m.outln(`${k}=${v}`); return; }
      const eq = raw.indexOf('=');
      if (eq < 0) {
        const pre = raw.trim().toUpperCase();
        const hits = Array.from(m.env).filter(([k]) => k.startsWith(pre));
        if (!hits.length) m.outln(`Environment variable ${pre} not defined`);
        for (const [k, v] of hits) m.outln(`${k}=${v}`);
        return;
      }
      const name = raw.slice(0, eq).trim().toUpperCase();
      if (!name) { m.outln('Syntax error'); return; }
      m.setEnv(name, raw.slice(eq + 1));
    }
  });

  Commands.register({
    name: 'PATH',
    raw: true,
    summary: 'Displays or sets a search path for executable files.',
    help: 'Displays or sets a search path for executable files.\n\nPATH [[drive:]path[;...]]\nPATH ;\n\nType PATH ; to clear all search-path settings and direct MS-DOS to search\nonly in the current directory.\nType PATH without parameters to display the current path.',
    async run(c) {
      const m = c.m;
      const raw = c.raw.replace(/^[\s=]+/, '').trim();
      if (!raw) { const p = m.getEnv('PATH'); m.outln(p ? `PATH=${p}` : 'No Path'); return; }
      if (raw === ';') { m.env.delete('PATH'); return; }
      m.setEnv('PATH', raw.toUpperCase());
    }
  });

  Commands.register({
    name: 'PROMPT',
    raw: true,
    summary: 'Changes the MS-DOS command prompt.',
    help: 'Changes the MS-DOS command prompt.\n\nPROMPT [text]\n\n  text    Specifies a new command prompt.\n\nPrompt can be made up of normal characters and the following special codes:\n\n  $Q   = (equal sign)          $$   $ (dollar sign)\n  $T   Current time            $D   Current date\n  $P   Current drive and path  $V   MS-DOS version number\n  $N   Current drive           $G   > (greater-than sign)\n  $L   < (less-than sign)      $B   | (pipe)\n  $H   Backspace               $_   Carriage return and linefeed\n\nType PROMPT without parameters to reset the prompt to $P$G.',
    async run(c) {
      const raw = c.raw.replace(/^[\s=]+/, '');
      c.m.setEnv('PROMPT', raw.trim() ? raw : '$P$G');
    }
  });

  Commands.register({
    name: 'HELP',
    summary: 'Provides help information for MS-DOS commands.',
    help: 'Provides help information for MS-DOS commands.\n\nHELP [command]\n\n  command  Displays help information on that command.\n\nYou can also type a command followed by /? to see its help.',
    async run(c) {
      const m = c.m;
      if (c.params.length) {
        const cmd = Commands.get(c.params[0]);
        if (cmd) m.outln(m.helpText(cmd));
        else if (DOS.Programs && DOS.Programs.get(c.params[0].toUpperCase())) m.outln(DOS.Programs.get(c.params[0].toUpperCase()).help || 'No help available.');
        else m.outln('Help not available for this command.');
        return;
      }
      const out = pager(m, true);
      await out('For more information on a specific command, type HELP command-name');
      for (const def of Commands.list()) {
        if (def.hidden) continue;
        const names = [def.name].concat(def.aliases || []).join('/');
        const text = names.padEnd(15) + def.summary;
        await out(text.length > 79 ? text.slice(0, 76) + '...' : text);
      }
      await out('');
      await out('External programs: PLASMA, BALL (graphics demos), MARIO (game).');
      await out('Batch files (.BAT) support IF, GOTO, FOR, CALL, SHIFT, CHOICE, PAUSE.');
    }
  });

  Commands.register({
    name: 'PAUSE',
    summary: 'Suspends processing of a batch program.',
    help: 'Suspends processing of a batch program and displays the message\n"Press any key to continue . . ."\n\nPAUSE',
    async run(c) {
      const m = c.m;
      m.term.ensureLineStart();
      m.term.write('Press any key to continue . . .');
      await m.readKey();
      m.term.write('\n');
    }
  });

  Commands.register({
    name: 'REM',
    raw: true,
    summary: 'Records comments (remarks) in batch files or CONFIG.SYS.',
    help: 'Records comments (remarks) in a batch file or CONFIG.SYS.\n\nREM [comment]\n\nA line beginning with :: is also treated as a comment in batch files.',
    async run() { }
  });

  Commands.register({
    name: 'CALL',
    raw: true,
    summary: 'Calls one batch program from another.',
    help: 'Calls one batch program from another.\n\nCALL [drive:][path]filename [batch-parameters]\n\n  batch-parameters   Specifies any command-line information required by the\n                     batch program.',
    async run(c) {
      const rest = c.raw.trim();
      if (!rest) return;
      await c.m.execute(rest, { expanded: true, call: true, batch: c.opts.batch });
    }
  });

  Commands.register({
    name: 'EXIT',
    summary: 'Quits the batch program or the command interpreter.',
    help: 'Quits the batch program currently running or the command interpreter.\n\nEXIT\n\nThe primary command interpreter cannot be closed.',
    async run(c) {
      const m = c.m;
      if (m.batchStack.length) { m.batchStack.length = 0; return; }
      m.outln('Cannot exit the primary command interpreter.');
    }
  });

  Commands.register({
    name: 'MEM',
    summary: 'Displays the amount of used and free memory in your system.',
    help: 'Displays the amount of used and free memory in your system.\n\nMEM [/CLASSIFY | /DEBUG | /FREE | /MODULE modulename] [/PAGE]\n\n  /C   Classifies programs by memory usage.\n  /F   Displays information about the amount of free memory left.\n  /P   Pauses after each screenful of information.',
    async run(c) {
      const m = c.m;
      const conv = m.programRunning ? 112 : 45;
      const lines = [
        '',
        'Memory Type        Total  =   Used  +   Free',
        '----------------  -------   -------   -------',
        `Conventional         640K   ${String(conv + 'K').padStart(7)}   ${String((640 - conv) + 'K').padStart(7)}`,
        'Upper                155K       27K      128K',
        'Reserved             384K      384K        0K',
        'Extended (XMS)    15,205K    2,149K   13,056K',
        '----------------  -------   -------   -------',
        `Total memory      16,384K   ${num(conv + 27 + 384 + 2149).padStart(6)}K   ${num(640 - conv + 128 + 13056).padStart(6)}K`,
        '',
        `Total under 1 MB     795K   ${String(conv + 27 + 'K').padStart(7)}   ${String((640 - conv + 128) + 'K').padStart(7)}`,
        '',
        `Largest executable program size     ${String((640 - conv) + 'K').padStart(5)} (${num((640 - conv) * 1024)} bytes)`,
        'Largest free upper memory block      128K (131,072 bytes)',
        'MS-DOS is resident in the high memory area.'
      ];
      if (c.switches.C !== undefined) {
        lines.splice(1, 0,
          'Modules using memory below 1 MB:',
          '',
          '  Name           Total  =   Conventional   +   Upper Memory',
          '  --------  ----------------   ----------------   ----------------',
          '  MSDOS       16,973   (17K)     16,973   (17K)          0    (0K)',
          '  HIMEM        1,168    (1K)      1,168    (1K)          0    (0K)',
          '  COMMAND      2,912    (3K)      2,912    (3K)          0    (0K)',
          '  SMARTDRV    27,488   (27K)          0    (0K)     27,488   (27K)',
          '  HTMLDOS     24,576   (24K)     24,576   (24K)          0    (0K)',
          '  Free       609,280  (595K)    609,280  (595K)          0    (0K)', '');
      }
      const out = pager(m, c.switches.P !== undefined);
      for (const l of lines) await out(l);
    }
  });

  Commands.register({
    name: 'CHKDSK',
    summary: 'Checks a disk and displays a status report.',
    help: 'Checks a disk and displays a status report.\n\nCHKDSK [drive:][[path]filename] [/F] [/V]\n\n  /F   Fixes errors on the disk.\n  /V   Displays the full path and name of every file on the disk.',
    async run(c) {
      const m = c.m, fs = m.fs;
      const letter = c.params[0] ? c.params[0][0].toUpperCase() : fs.curDrive;
      const d = fs.drives[letter];
      if (!d) { m.outln('Invalid drive specification'); return; }
      const u = fs.usage(letter);
      const cluster = d.removable ? 512 : 8192;
      const cl = (b) => Math.ceil(b / cluster) * cluster;
      const created = new Date(d.created);
      const w = 13;
      const L = (n, text) => m.outln(num(n).padStart(w) + ' ' + text);
      m.outln('');
      m.outln(`Volume ${d.label || '(no label)'}   created ${pad2(created.getMonth() + 1)}-${pad2(created.getDate())}-${created.getFullYear()} ${fmtTime(d.created)}`);
      m.outln(`Volume Serial Number is ${d.serial}`);
      m.outln('');
      const hid = cl(u.hiddenBytes), dirs = u.dirs * cluster, files = cl(u.bytes);
      const avail = Math.max(0, d.capacity - hid - dirs - files);
      L(d.capacity, 'bytes total disk space');
      if (u.hidden) L(hid, `bytes in ${u.hidden} hidden files`);
      L(dirs, `bytes in ${u.dirs} directories`);
      L(files, `bytes in ${u.files} user files`);
      L(avail, 'bytes available on disk');
      m.outln('');
      L(cluster, 'bytes in each allocation unit');
      L(d.capacity / cluster, 'total allocation units on disk');
      L(avail / cluster, 'available allocation units on disk');
      m.outln('');
      L(655360, 'total bytes memory');
      L(609280, 'bytes free');
      if (c.switches.V !== undefined) {
        const walk = (n, path) => { for (const ch of n.children.values()) { m.outln(path + '\\' + ch.name); if (ch.type === 'dir') walk(ch, path + '\\' + ch.name); } };
        m.outln('');
        walk(d.root, letter + ':');
      }
      m.outln('');
      m.outln('Instead of using CHKDSK, try using SCANDISK. SCANDISK can reliably detect');
      m.outln('and fix a much wider range of disk problems.');
    }
  });

  // ------------------------------------------------------------------
  // 批处理控制
  // ------------------------------------------------------------------

  Commands.register({
    name: 'IF',
    raw: true,
    summary: 'Performs conditional processing in batch programs.',
    help: 'Performs conditional processing in batch programs.\n\nIF [NOT] ERRORLEVEL number command\nIF [NOT] string1==string2 command\nIF [NOT] EXIST filename command\n\n  NOT               Specifies that MS-DOS should carry out the command only\n                    if the condition is false.\n  ERRORLEVEL number Specifies a true condition if the last program run\n                    returned an exit code equal to or greater than the number.\n  string1==string2  Specifies a true condition if the specified text strings\n                    match (case sensitive; use IF /I to ignore case).\n  EXIST filename    Specifies a true condition if the specified file exists.',
    async run(c) {
      const m = c.m;
      let st;
      try { st = DOS.Parser.parseIf(c.raw); } catch (e) { m.outln('Syntax error'); return; }
      let ok;
      if (st.type === 'errorlevel') ok = m.errorLevel >= st.level;
      else if (st.type === 'exist') {
        try { const g = m.fs.glob(st.path); ok = DOS.Parser.hasWildcard(st.path) ? g.entries.some(e => e.type === 'file') : m.fs.exists(st.path); }
        catch (e) { ok = false; }
      } else ok = st.ignoreCase ? st.a.toUpperCase() === st.b.toUpperCase() : st.a === st.b;
      if (st.not) ok = !ok;
      if (ok) await m.execute(st.command, { expanded: true, batch: c.opts.batch });
    }
  });

  Commands.register({
    name: 'GOTO',
    summary: 'Directs MS-DOS to a labelled line in a batch program.',
    help: 'Directs MS-DOS to a line in a batch program that is marked by a label.\n\nGOTO label\n\n  label   Specifies a text string used in the batch program as a label.\n\nYou type a label on a line by itself, beginning with a colon.',
    async run(c) {
      const m = c.m;
      const ctx = m.batchStack[m.batchStack.length - 1];
      if (!ctx) return;
      const label = c.raw.trim();
      const idx = DOS.Batch.findLabel(ctx, label);
      if (idx < 0) { m.outln('Label not found'); m.batchStack.length = 0; return; }
      ctx.ip = idx + 1;
    }
  });

  Commands.register({
    name: 'SHIFT',
    summary: 'Changes the position of replaceable parameters in a batch file.',
    help: 'Changes the position of replaceable parameters in a batch file.\n\nSHIFT',
    async run(c) {
      const ctx = c.m.batchStack[c.m.batchStack.length - 1];
      if (ctx) ctx.args.shift();
    }
  });

  Commands.register({
    name: 'FOR',
    raw: true,
    summary: 'Runs a specified command for each file in a set of files.',
    help: 'Runs a specified command for each file in a set of files.\n\nFOR %variable IN (set) DO command [command-parameters]\n\n  %variable  Specifies a replaceable parameter.\n  (set)      Specifies a set of one or more files. Wildcards may be used.\n  command    Specifies the command to carry out for each file.\n\nUse %%variable instead of %variable in batch programs.',
    async run(c) {
      const m = c.m;
      let st;
      try { st = DOS.Parser.parseFor(c.raw); } catch (e) { m.outln('Syntax error'); return; }
      const items = [];
      for (const it of st.items) {
        if (DOS.Parser.hasWildcard(it)) {
          try {
            const g = m.fs.glob(it);
            const slash = Math.max(it.lastIndexOf('\\'), it.lastIndexOf(':'));
            const prefix = slash >= 0 ? it.slice(0, slash + 1) : '';
            for (const e of g.entries) if (e.type === 'file' && !(e.attr & ATTR().H)) items.push(prefix + e.name);
          } catch (e) { /* 无匹配 */ }
        } else items.push(it);
      }
      const re = new RegExp('%' + st.variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      for (const it of items) {
        m.checkBreak();
        const cmd = st.command.replace(re, () => it);
        if (m.echo && c.opts.batch) m.out('\n' + m.promptString() + cmd + '\n');
        await m.execute(cmd, { expanded: true, batch: c.opts.batch });
        if (!m.batchStack.length && c.opts.batch) break; // 已被终止
      }
    }
  });

  Commands.register({
    name: 'CHOICE',
    raw: true,
    summary: 'Waits for the user to choose one of a set of choices.',
    help: 'Waits for the user to choose one of a set of choices.\n\nCHOICE [/C[:]choices] [/N] [/S] [/T[:]c,nn] [text]\n\n  /C[:]choices Specifies allowable keys. Default is YN\n  /N           Do not display choices and ? at end of prompt string.\n  /S           Treat choice keys as case sensitive.\n  /T[:]c,nn    Default choice to c after nn seconds\n  text         Prompt string to display\n\nERRORLEVEL is set to offset of key user presses in choices.',
    async run(c) {
      const m = c.m;
      if (c.raw.trim() === '/?') { m.outln(this.help); return; }
      const a = DOS.Parser.parseArgs(c.raw);
      // 文本部分保留原样：去掉开关
      const text = c.raw.replace(/\/[A-Za-z?](:?[^\s/]*)?/g, '').trim();
      const caseSens = a.switches.S !== undefined;
      let choices = a.switches.C !== undefined ? (/\/C:?([^\s/]+)/i.exec(c.raw) || [, 'YN'])[1] : 'YN';
      if (!caseSens) choices = choices.toUpperCase();
      let timeout = null, def = null;
      if (a.switches.T !== undefined) {
        const tm = /\/T:?(\S),(\d{1,2})/i.exec(c.raw);
        if (!tm) { m.outln('CHOICE: Incorrect timeout syntax.  Expected form Tc,nn or T:c,nn'); m.errorLevel = 255; return; }
        def = caseSens ? tm[1] : tm[1].toUpperCase();
        timeout = +tm[2];
        if (!choices.includes(def)) { m.outln('CHOICE: Timeout default not in specified (or default) choices.'); m.errorLevel = 255; return; }
      }
      m.term.ensureLineStart();
      m.term.write(text + (a.switches.N === undefined ? `${text ? ' ' : ''}[${choices.split('').join(',')}]?` : ''));
      const deadline = timeout !== null ? Date.now() + timeout * 1000 : 0;
      for (;;) {
        const ev = await m.readKey(timeout !== null ? Math.max(1, deadline - Date.now()) : 0);
        let ch;
        if (ev === null) ch = def;
        else ch = caseSens ? ev.char : (ev.char || '').toUpperCase();
        const idx = ch ? choices.indexOf(ch) : -1;
        if (idx >= 0) { m.term.write(ch + '\n'); m.errorLevel = idx + 1; return; }
        if (m.onBell) m.onBell();
      }
    }
  });

  // ------------------------------------------------------------------
  // 过滤器（管道）
  // ------------------------------------------------------------------

  Commands.register({
    name: 'MORE',
    summary: 'Displays output one screen at a time.',
    help: 'Displays output one screen at a time.\n\nMORE < [drive:][path]filename\ncommand-name | MORE\nMORE [drive:][path]filename',
    async run(c) {
      const m = c.m;
      let inputs;
      try { inputs = readInput(c, c.params); } catch (e) { return fsErr(m, e); }
      if (!inputs) { m.outln('Required parameter missing'); return; }
      const out = pager(m, true, '-- More --');
      for (const inp of inputs) for (const line of printable(inp.text).replace(/\n$/, '').split('\n')) await out(line);
    }
  });

  Commands.register({
    name: 'SORT',
    summary: 'Sorts input and writes results to the screen, a file, or another device.',
    help: 'Sorts input and writes results to the screen, a file, or another device.\n\nSORT [/R] [/+n] [[drive1:][path1]filename1] [> [drive2:][path2]filename2]\n[command |] SORT [/R] [/+n] [> [drive2:][path2]filename2]\n\n  /R   Reverses the sort order; that is, sorts Z to A, then 9 to 0.\n  /+n  Sorts the file according to characters in column n.',
    async run(c) {
      const m = c.m;
      let inputs;
      try { inputs = readInput(c, c.params); } catch (e) { return fsErr(m, e); }
      if (!inputs) { m.outln('Required parameter missing'); return; }
      const col = Math.max(1, +((/\/\+(\d+)/.exec(c.raw) || [, 1])[1])) - 1;
      const lines = inputs.map(i => i.text.replace(/\n$/, '')).join('\n').split('\n');
      lines.sort((a, b) => a.slice(col).toUpperCase().localeCompare(b.slice(col).toUpperCase()));
      if (c.switches.R !== undefined) lines.reverse();
      for (const l of lines) m.outln(l);
    }
  });

  Commands.register({
    name: 'FIND',
    raw: true,
    summary: 'Searches for a text string in a file or files.',
    help: 'Searches for a text string in a file or files.\n\nFIND [/V] [/C] [/N] [/I] "string" [[drive:][path]filename[ ...]]\n\n  /V   Displays all lines NOT containing the specified string.\n  /C   Displays only the count of lines containing the string.\n  /N   Displays line numbers with the displayed lines.\n  /I   Ignores the case of characters when searching for the string.',
    async run(c) {
      const m = c.m;
      if (c.raw.trim() === '/?') { m.outln(this.help); return; }
      const q = /"([^"]*)"/.exec(c.raw);
      if (!q) { m.outln('FIND: Parameter format not correct'); return; }
      const rest = c.raw.slice(0, q.index) + c.raw.slice(q.index + q[0].length);
      const a = DOS.Parser.parseArgs(rest);
      const sw = a.switches;
      let inputs;
      try { inputs = readInput(c, a.params); } catch (e) { m.outln(`File not found - ${a.params[0].toUpperCase()}`); return; }
      if (!inputs) { m.outln('FIND: Parameter format not correct'); return; }
      const needle = sw.I !== undefined ? q[1].toUpperCase() : q[1];
      for (const inp of inputs) {
        if (inp.name) m.outln(`\n---------- ${m.fs.stat(inp.name).path}${sw.C !== undefined ? ':' : ''}`.replace(/:$/, ':'));
        const lines = inp.text.replace(/\n$/, '').split('\n');
        let count = 0;
        lines.forEach((l, i) => {
          const hay = sw.I !== undefined ? l.toUpperCase() : l;
          const hit = hay.includes(needle) !== (sw.V !== undefined);
          if (!hit) return;
          count++;
          if (sw.C === undefined) m.outln((sw.N !== undefined ? `[${i + 1}]` : '') + l);
        });
        if (sw.C !== undefined) m.outln(String(count));
      }
    }
  });

  // ------------------------------------------------------------------
  // 磁盘
  // ------------------------------------------------------------------

  Commands.register({
    name: 'FORMAT',
    summary: 'Formats a disk for use with MS-DOS (erases all files).',
    help: 'Formats a disk for use with MS-DOS.\n\nFORMAT drive: [/V[:label]] [/Q] [/S]\n\n  /V[:label]  Specifies the volume label.\n  /Q          Performs a quick format.\n  /S          Copies system files to the formatted disk.\n\nWARNING: all files on the drive are erased (the change is saved).',
    async run(c) {
      const m = c.m, fs = m.fs;
      const p = c.params[0];
      if (!p || !/^[A-Za-z]:?$/.test(p)) { m.outln('Required parameter missing'); return; }
      const letter = p[0].toUpperCase();
      const d = fs.drives[letter];
      if (!d) { m.outln('Invalid drive specification'); return; }
      if (d.removable) {
        m.term.write(`Insert new diskette for drive ${letter}:\nand press ENTER when ready...`);
        for (;;) { const ev = await m.readKey(); if (ev.key === 'Enter') break; }
        m.term.write('\n');
      } else {
        m.term.write(`\nWARNING, ALL DATA ON NON-REMOVABLE DISK\nDRIVE ${letter}: WILL BE LOST!\n`);
        if ((await ask(m, 'Proceed with Format (Y/N)? ')) !== 'Y') return;
      }
      m.outln('');
      m.outln('Checking existing disk format.');
      m.outln(`Formatting ${d.removable ? '1.44M' : Math.round(d.capacity / 1048576) + 'M'}`);
      for (let pct = 0; pct <= 100; pct += c.switches.Q !== undefined ? 50 : 10) {
        m.term.write(`\r${pct} percent completed.`);
        await m.sleep(c.switches.Q !== undefined ? 60 : 90);
      }
      m.term.write('\n');
      m.outln('Format complete.');
      let label = c.switches.V !== undefined && c.switches.V ? c.switches.V : null;
      const files = c.switches.S !== undefined ? DOS.DiskImage.systemFiles() : null;
      if (files) m.outln('System transferred');
      if (label === null) {
        m.term.write('\nVolume label (11 characters, ENTER for none)? ');
        label = (await m.readLine()) || '';
      }
      fs.formatDrive(letter, { label: label.trim(), files });
      const u = fs.usage(letter);
      m.outln('');
      m.outln(`${num(d.capacity).padStart(13)} bytes total disk space`);
      if (u.hidden) m.outln(`${num(u.hiddenBytes).padStart(13)} bytes used by system`);
      m.outln(`${num(u.free).padStart(13)} bytes available on disk`);
      m.outln('');
      const cluster = d.removable ? 512 : 8192;
      m.outln(`${num(cluster).padStart(13)} bytes in each allocation unit.`);
      m.outln(`${num(Math.floor(u.free / cluster)).padStart(13)} allocation units available on disk.`);
      m.outln('');
      m.outln(`Volume Serial Number is ${fs.drives[letter].serial}`);
      if (d.removable) {
        m.outln('');
        await ask(m, 'Format another (Y/N)? ');
      }
    }
  });

  Commands.register({
    name: 'LABEL',
    raw: true,
    summary: 'Creates, changes, or deletes the volume label of a disk.',
    help: 'Creates, changes, or deletes the volume label of a disk.\n\nLABEL [drive:][label]',
    async run(c) {
      const m = c.m, fs = m.fs;
      let raw = c.raw.trim();
      let letter = fs.curDrive;
      const dm = /^([A-Za-z]):\s*/.exec(raw);
      if (dm) { letter = dm[1].toUpperCase(); raw = raw.slice(dm[0].length); }
      const d = fs.drives[letter];
      if (!d) { m.outln('Invalid drive specification'); return; }
      if (!raw) {
        m.outln(d.label ? ` Volume in drive ${letter} is ${d.label}` : ` Volume in drive ${letter} has no label`);
        m.outln(` Volume Serial Number is ${d.serial}`);
        m.term.write('Volume label (11 characters, ENTER for none)? ');
        raw = (await m.readLine()) || '';
        if (!raw.trim() && d.label) {
          if ((await ask(m, '\nDelete current volume label (Y/N)? ')) !== 'Y') return;
        } else if (!raw.trim()) return;
      }
      fs.setLabel(letter, raw.trim());
    }
  });

  // ------------------------------------------------------------------
  // 图形 / 娱乐 / 界面
  // ------------------------------------------------------------------

  Commands.register({
    name: 'MODE',
    summary: 'Switches video mode (MODE 13 = 320x200x256, MODE 3 / MODE 80 = text).',
    help: 'Configures the display mode.\n\nMODE 13      Switches to VGA mode 13h (320x200, 256 colours, 40x25 text)\nMODE 3       Switches back to 80x25 colour text mode\nMODE 80      Same as MODE 3 (also CO80)\nMODE CON     Displays the status of the console\n\nGraphics programs such as PLASMA and BALL switch modes by themselves and\nreturn to text mode when you press Esc.',
    async run(c) {
      const m = c.m;
      const p = (c.params[0] || '').toUpperCase();
      if (!p || p === 'CON') {
        m.outln('');
        m.outln('Status for device CON:');
        m.outln('----------------------');
        m.outln(`Columns=${m.term.cols}`);
        m.outln(`Lines=${m.term.rows}`);
        m.outln(`Video mode=${m.display === 'text' ? '03h (text)' : '13h (graphics)'}`);
        return;
      }
      if (['13', '13H', '0X13', '19'].includes(p)) { m.setVideoMode(0x13); return; }
      if (['3', '03', '03H', '3H', '80', 'CO80', 'BW80', 'MONO'].includes(p)) { m.setVideoMode(3); return; }
      m.outln(`Invalid parameter - ${c.params[0]}`);
    }
  });

  Commands.register({
    name: 'BEEP',
    summary: 'Sounds a square-wave beep through the PC speaker (Web Audio).',
    help: 'Sounds a beep through the emulated PC speaker.\n\nBEEP [frequency] [duration]\n\n  frequency  Tone in Hz (37-32767, default 800)\n  duration   Length in milliseconds (default 200)',
    async run(c) {
      const m = c.m;
      const f = Math.max(37, Math.min(32767, +c.params[0] || 800));
      const d = Math.max(10, Math.min(5000, +c.params[1] || 200));
      m.audio.beep(f, d);
      await m.sleep(d);
    }
  });

  Commands.register({
    name: 'MARIO',
    summary: 'Starts the World 1-1 tribute platform game (MARIO /? for keys).',
    help: () => (DOS.Programs.get('MARIO') || {}).help,
    async run(c) {
      const prog = DOS.Programs.get('MARIO');
      await c.m.runProgram(prog, c.raw, c.params, c.switches);
    }
  });

  Commands.register({
    name: 'COLOR',
    summary: 'Sets the default console foreground and background colours.',
    help: 'Sets the default console foreground and background colors.\n\nCOLOR [attr]\n\n  attr   Two hex digits: the first is the background, the second the\n         foreground (0=Black 1=Blue 2=Green 3=Aqua 4=Red 5=Purple 6=Yellow\n         7=White 8=Gray 9=Light Blue A=Light Green B=Light Aqua C=Light Red\n         D=Light Purple E=Light Yellow F=Bright White). COLOR alone resets 07.',
    async run(c) {
      const m = c.m;
      const p = (c.params[0] || '07').toUpperCase();
      if (!/^[0-9A-F]{1,2}$/.test(p)) { m.outln('Invalid parameter'); m.errorLevel = 1; return; }
      const attr = parseInt(p, 16);
      if ((attr & 15) === (attr >> 4)) { m.errorLevel = 1; return; }
      m.term.attr = attr;
      m.term.attrs.fill(attr);
      m.term.dirty = true;
    }
  });

  Commands.register({
    name: 'THEME',
    summary: 'Selects the screen colour theme (CLASSIC, GREEN, AMBER, BLUE).',
    help: 'Selects the screen colour theme.\n\nTHEME [CLASSIC | GREEN | AMBER | BLUE]\n\nWithout a parameter the current and available themes are listed.\nThe toolbar button above the screen cycles themes as well.',
    async run(c) {
      const m = c.m;
      const p = (c.params[0] || '').toLowerCase();
      if (!p) {
        m.outln(`Current theme: ${m.settings.theme.toUpperCase()}`);
        m.outln('Available: ' + Object.keys(DOS.THEMES).map(k => k.toUpperCase()).join(', '));
        return;
      }
      if (!DOS.THEMES[p]) { m.outln(`Invalid parameter - ${c.params[0]}`); return; }
      m.updateSettings({ theme: p });
    }
  });

  Commands.register({
    name: 'CRT',
    summary: 'Turns the CRT effect (scanlines and glow) on or off.',
    help: 'Turns the CRT screen effect (scanlines, slight glow) on or off.\n\nCRT [ON | OFF]',
    async run(c) {
      const m = c.m;
      const p = (c.params[0] || '').toUpperCase();
      if (!p) { m.outln(`CRT effect is ${m.settings.crt ? 'ON' : 'OFF'}`); return; }
      if (p !== 'ON' && p !== 'OFF') { m.outln(`Invalid parameter - ${c.params[0]}`); return; }
      m.updateSettings({ crt: p === 'ON' });
    }
  });

  Commands.register({
    name: 'DOSKEY',
    summary: 'Shows the command history (DOSKEY /HISTORY).',
    help: 'Edits command lines and recalls previous commands.\n\nDOSKEY [/HISTORY]\n\n  /HISTORY  Displays all commands stored in memory (also /H).\n\nDOSKEY editing is always active: Up/Down recall commands, F1/F3 copy the\nprevious command, Tab completes names.',
    async run(c) {
      const m = c.m;
      if (c.switches.H !== undefined) { for (const h of m.input.history) m.outln(h); return; }
      m.outln('DOSKEY is already installed.');
    }
  });

  DOS.Commands = Commands;
  DOS.CommandUtils = { applyTemplate, fmtDate, fmtTime, num, parseDate, parseTime, printable, splitName };
})(typeof globalThis !== 'undefined' ? globalThis : this);
