/*
 * FileSystem —— 内存虚拟磁盘、路径解析与 localStorage 持久化
 * ---------------------------------------------------------------
 * - 多盘符（A: 软盘 1.44MB，C: 硬盘），每个盘符独立维护当前目录。
 * - 8.3 文件名，大小写不敏感，内部统一大写。
 * - 文件内容：文本直接存字符串；二进制以 Base64 存储（binary = true）。
 * - 每次修改后同步写入 storage（浏览器为 localStorage，测试中可为内存对象）。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const ATTR = { R: 1, H: 2, S: 4, D: 16, A: 32 };
  const INVALID_CHARS = /[\s"*+,/:;<=>?[\\\]|\x00-\x1F]/;
  const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'LPT1', 'LPT2', 'LPT3', 'CLOCK$']);

  /** 文件系统错误（code 用于命令层映射 DOS 风格消息） */
  class FsError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  /** DOS 风格错误消息 */
  const MESSAGES = {
    NOT_FOUND: 'File not found',
    PATH_NOT_FOUND: 'Path not found',
    INVALID_DRIVE: 'Invalid drive specification',
    INVALID_NAME: 'Invalid filename or file not found',
    EXISTS: 'File exists',
    NOT_EMPTY: 'Invalid path, not directory,\nor directory not empty',
    ACCESS_DENIED: 'Access denied',
    DISK_FULL: 'Insufficient disk space',
    IS_DIR: 'Access denied',
    NOT_DIR: 'Invalid directory'
  };

  const b64 = {
    encode(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    decode(str) {
      const s = atob(str);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
    byteLength(str) {
      if (!str) return 0;
      const pad = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
      return Math.floor(str.length * 3 / 4) - pad;
    }
  };

  function makeDir(name, mtime) { return { type: 'dir', name, attr: ATTR.D, mtime, children: new Map() }; }
  function makeFile(name, mtime, data, binary, attr) { return { type: 'file', name, attr: attr === undefined || attr === null ? ATTR.A : attr, mtime, data, binary: !!binary }; }

  /** 节点大小（字节） */
  function sizeOf(node) {
    if (node.type !== 'file') return 0;
    return node.binary ? b64.byteLength(node.data) : node.data.length;
  }

  /**
   * DOS 通配符匹配（* 与 ?，文件名与扩展名分别匹配）。
   * 不含通配符时为精确匹配；含通配符但无扩展名部分时视为 ".*"。
   * @param {string} name 文件名（大写）
   * @param {string} pattern 模式
   * @returns {boolean}
   */
  function wildMatch(name, pattern) {
    pattern = pattern.toUpperCase();
    name = name.toUpperCase();
    const hasWild = /[*?]/.test(pattern);
    if (!hasWild) return name === pattern.replace(/\.$/, '');
    const split = (s) => { const i = s.lastIndexOf('.'); return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)]; };
    let [pb, pe] = split(pattern);
    const [nb, ne] = split(name);
    if (pe === null) pe = '*';
    const toRe = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.?') + '$');
    return toRe(pb).test(nb) && toRe(pe).test(ne || '');
  }

  class FileSystem {
    /**
     * @param {{storage?:{getItem:Function,setItem:Function,removeItem?:Function}, key?:string, clock?:function():number, image?:function():object}} [opts]
     */
    constructor(opts = {}) {
      this.storage = opts.storage || null;
      this.key = opts.key || 'htmldos.fs.v1';
      this.clock = opts.clock || (() => Date.now());
      this.imageFactory = opts.image || (() => (DOS.DiskImage ? DOS.DiskImage.build() : null));
      this.drives = {};
      this.curDrive = 'C';
      this.cwd = {};
      this.onChange = null;
      /** @type {null|function(string,string):void} 磁盘访问回调 (盘符, 'r'|'w')，用于界面上的硬盘/软驱指示灯 */
      this.onActivity = null;
      this.lastDrive = 'C';
      if (!this.load()) this.reset();
    }

    /** 恢复出厂磁盘内容 */
    reset() {
      const img = this.imageFactory();
      this.drives = {};
      this.cwd = {};
      const specs = (img && img.drives) || { A: { label: '', capacity: 1457664, files: {} }, C: { label: 'MS-DOS_6', capacity: 536870912, files: {} } };
      for (const letter of Object.keys(specs)) {
        const spec = specs[letter];
        const d = this._newDrive(letter, spec);
        this._populate(d.root, spec.files || {});
      }
      this.curDrive = 'C';
      this.save();
    }

    _newDrive(letter, spec) {
      const d = {
        letter,
        label: spec.label || '',
        serial: spec.serial || this._serial(),
        capacity: spec.capacity || 536870912,
        removable: !!spec.removable,
        created: spec.created || this.clock(),
        root: makeDir('', spec.created || this.clock())
      };
      this.drives[letter] = d;
      this.cwd[letter] = [];
      return d;
    }

    _serial() {
      const h = () => Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
      return h() + '-' + h();
    }

    /** 由镜像描述填充目录：值为字符串=文本文件，{dir:{...}}=目录，{b64|text, attr, mtime}=文件 */
    _populate(dir, files) {
      for (const name of Object.keys(files)) {
        const v = files[name];
        const up = name.toUpperCase();
        if (v && typeof v === 'object' && v.dir) {
          const d = makeDir(up, v.mtime || this.clock());
          if (v.attr) d.attr |= v.attr;
          dir.children.set(up, d);
          this._populate(d, v.dir);
        } else if (typeof v === 'string') {
          dir.children.set(up, makeFile(up, this.clock(), v, false));
        } else {
          const binary = v.b64 !== undefined;
          dir.children.set(up, makeFile(up, v.mtime || this.clock(), binary ? v.b64 : v.text, binary, v.attr));
        }
      }
    }

    // ---------------- 持久化 ----------------

    /** 序列化为普通对象 */
    serialize() {
      const enc = (n) => n.type === 'dir'
        ? { t: 'd', n: n.name, a: n.attr, m: n.mtime, c: Array.from(n.children.values()).map(enc) }
        : { t: 'f', n: n.name, a: n.attr, m: n.mtime, d: n.data, b: n.binary ? 1 : 0 };
      const drives = {};
      for (const k of Object.keys(this.drives)) {
        const d = this.drives[k];
        drives[k] = { label: d.label, serial: d.serial, capacity: d.capacity, removable: d.removable, created: d.created, root: enc(d.root) };
      }
      return { v: 1, cur: this.curDrive, cwd: this.cwd, drives };
    }

    /** 从对象恢复 */
    deserialize(obj) {
      const dec = (o) => {
        if (o.t === 'd') {
          const d = makeDir(o.n, o.m);
          d.attr = o.a;
          for (const c of o.c) d.children.set(c.n, dec(c));
          return d;
        }
        return makeFile(o.n, o.m, o.d, o.b === 1, o.a);
      };
      this.drives = {};
      this.cwd = {};
      for (const k of Object.keys(obj.drives)) {
        const s = obj.drives[k];
        this.drives[k] = { letter: k, label: s.label, serial: s.serial, capacity: s.capacity, removable: s.removable, created: s.created, root: dec(s.root) };
        this.cwd[k] = (obj.cwd && obj.cwd[k]) || [];
      }
      this.curDrive = this.drives[obj.cur] ? obj.cur : 'C';
      for (const k of Object.keys(this.drives)) if (!this._dirAt(k, this.cwd[k])) this.cwd[k] = [];
    }

    /** 写入 storage */
    save() {
      if (this.onChange) this.onChange();
      this._activity('w');
      if (!this.storage) return;
      try { this.storage.setItem(this.key, JSON.stringify(this.serialize())); }
      catch (e) { /* 存储配额不足时静默忽略，内存中的数据仍然有效 */ }
    }

    /** 从 storage 读取 @returns {boolean} */
    load() {
      if (!this.storage) return false;
      try {
        const raw = this.storage.getItem(this.key);
        if (!raw) return false;
        this.deserialize(JSON.parse(raw));
        return true;
      } catch (e) { return false; }
    }

    // ---------------- 路径 ----------------

    /** 校验 8.3 文件名 */
    static validName(name) {
      if (!name || name === '.' || name === '..') return false;
      const parts = name.split('.');
      if (parts.length > 2) return false;
      const [base, ext = ''] = parts;
      if (!base || base.length > 8 || ext.length > 3) return false;
      if (INVALID_CHARS.test(base) || INVALID_CHARS.test(ext)) return false;
      return !RESERVED.has(base.toUpperCase());
    }

    /**
     * 解析路径为绝对位置。
     * @param {string} path 如 "C:\\GAMES\\..\\UTILS"、"A:"、"FOO.TXT"
     * @returns {{drive:string, parts:string[]}}
     */
    resolve(path) {
      path = String(path || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '\\');
      let drive = this.curDrive;
      const m = /^([A-Za-z]):(.*)$/.exec(path);
      if (m) { drive = m[1].toUpperCase(); path = m[2]; }
      if (!this.drives[drive]) throw new FsError('INVALID_DRIVE');
      this.lastDrive = drive;
      let parts = path.startsWith('\\') ? [] : this.cwd[drive].slice();
      for (let seg of path.split('\\')) {
        seg = seg.trim().toUpperCase();
        if (!seg || seg === '.') continue;
        if (seg === '..') { parts.pop(); continue; }
        if (/^\.{3,}$/.test(seg)) { parts.pop(); parts.pop(); continue; }
        parts.push(seg.replace(/\.$/, ''));
      }
      return { drive, parts };
    }

    /** 绝对路径字符串，如 C:\GAMES */
    format(loc) { return loc.drive + ':\\' + loc.parts.join('\\'); }

    _dirAt(drive, parts) {
      let n = this.drives[drive] && this.drives[drive].root;
      for (const p of parts) {
        if (!n || n.type !== 'dir') return null;
        n = n.children.get(p);
      }
      return n && n.type === 'dir' ? n : null;
    }

    _nodeAt(loc) {
      let n = this.drives[loc.drive].root;
      for (const p of loc.parts) {
        if (n.type !== 'dir') return null;
        n = n.children.get(p);
        if (!n) return null;
      }
      return n;
    }

    /** 取父目录节点与末段名称；父目录不存在时抛 PATH_NOT_FOUND */
    _parentOf(loc) {
      const parent = this._dirAt(loc.drive, loc.parts.slice(0, -1));
      if (!parent) throw new FsError('PATH_NOT_FOUND');
      return { parent, name: loc.parts[loc.parts.length - 1] };
    }

    /** 通知一次磁盘访问（最近解析的路径所在盘符） */
    _activity(kind) { if (this.onActivity) this.onActivity(this.lastDrive, kind); }

    // ---------------- 查询 ----------------

    /**
     * 取节点信息。
     * @returns {null|{type:string,name:string,attr:number,mtime:number,size:number,path:string,node:object}}
     */
    stat(path) {
      let loc;
      try { loc = typeof path === 'string' ? this.resolve(path) : path; } catch (e) { return null; }
      const n = this._nodeAt(loc);
      if (!n) return null;
      return { type: n.type, name: n.name, attr: n.attr, mtime: n.mtime, size: sizeOf(n), path: this.format(loc), node: n, loc };
    }

    exists(path) { return !!this.stat(path); }
    isDir(path) { const s = this.stat(path); return !!s && s.type === 'dir'; }
    isFile(path) { const s = this.stat(path); return !!s && s.type === 'file'; }

    /** 列出目录内容 @returns {object[]} 节点数组（插入顺序） */
    list(path) {
      const loc = typeof path === 'string' ? this.resolve(path) : path;
      const d = this._dirAt(loc.drive, loc.parts);
      if (!d) throw new FsError('PATH_NOT_FOUND');
      this.lastDrive = loc.drive;
      this._activity('r');
      return Array.from(d.children.values()).map(n => ({ type: n.type, name: n.name, attr: n.attr, mtime: n.mtime, size: sizeOf(n), node: n }));
    }

    /**
     * 按带通配符的路径查找。路径为目录时返回目录下全部条目。
     * @param {string} spec 如 "*.TXT"、"C:\\GAMES\\B*.*"、"GAMES"
     * @returns {{dir:{drive:string,parts:string[]}, pattern:string, entries:object[]}}
     */
    glob(spec) {
      const loc = this.resolve(spec || '.');
      const raw = String(spec || '').trim();
      const n = this._nodeAt(loc);
      if (n && n.type === 'dir' && !/[*?]/.test(raw)) {
        return { dir: loc, pattern: '*.*', entries: this.list(loc) };
      }
      if (!loc.parts.length) return { dir: loc, pattern: '*.*', entries: this.list(loc) };
      const dirLoc = { drive: loc.drive, parts: loc.parts.slice(0, -1) };
      const pattern = loc.parts[loc.parts.length - 1];
      const d = this._dirAt(dirLoc.drive, dirLoc.parts);
      if (!d) throw new FsError('PATH_NOT_FOUND');
      const entries = this.list(dirLoc).filter(e => wildMatch(e.name, pattern));
      return { dir: dirLoc, pattern, entries };
    }

    /** 磁盘使用情况 */
    usage(drive) {
      const d = this.drives[drive];
      if (!d) throw new FsError('INVALID_DRIVE');
      const st = { files: 0, dirs: 0, hidden: 0, hiddenBytes: 0, bytes: 0, dirBytes: 0 };
      const walk = (n) => {
        for (const c of n.children.values()) {
          if (c.type === 'dir') { st.dirs++; st.dirBytes += 2048; walk(c); }
          else {
            const s = sizeOf(c);
            if (c.attr & ATTR.H) { st.hidden++; st.hiddenBytes += s; } else { st.files++; st.bytes += s; }
          }
        }
      };
      walk(d.root);
      const used = st.bytes + st.hiddenBytes + st.dirBytes;
      return Object.assign(st, { total: d.capacity, used, free: Math.max(0, d.capacity - used) });
    }

    _checkSpace(drive, delta) {
      if (delta > 0 && this.usage(drive).free < delta) throw new FsError('DISK_FULL');
    }

    // ---------------- 读写 ----------------

    /** 读取文本（二进制文件按 Latin-1 解码） */
    readText(path) {
      const s = this.stat(path);
      if (!s) throw new FsError('NOT_FOUND');
      if (s.type === 'dir') throw new FsError('IS_DIR');
      this._activity('r');
      if (!s.node.binary) return s.node.data;
      const bytes = b64.decode(s.node.data);
      let out = '';
      for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return out;
    }

    /** 读取字节 @returns {Uint8Array} */
    readBytes(path) {
      const s = this.stat(path);
      if (!s) throw new FsError('NOT_FOUND');
      if (s.type === 'dir') throw new FsError('IS_DIR');
      this._activity('r');
      if (s.node.binary) return b64.decode(s.node.data);
      const out = new Uint8Array(s.node.data.length);
      for (let i = 0; i < out.length; i++) out[i] = s.node.data.charCodeAt(i) & 0xFF;
      return out;
    }

    _write(path, data, binary, append) {
      const loc = this.resolve(path);
      if (!loc.parts.length) throw new FsError('ACCESS_DENIED');
      const { parent, name } = this._parentOf(loc);
      if (!FileSystem.validName(name)) throw new FsError('INVALID_NAME');
      const existing = parent.children.get(name);
      if (existing && existing.type === 'dir') throw new FsError('ACCESS_DENIED');
      if (existing && (existing.attr & ATTR.R)) throw new FsError('ACCESS_DENIED');
      if (append && existing) {
        const prev = existing.binary ? this.readText(path) : existing.data;
        data = prev + data;
        binary = false;
      }
      const newSize = binary ? b64.byteLength(data) : data.length;
      this._checkSpace(loc.drive, newSize - (existing ? sizeOf(existing) : 0));
      if (existing) {
        existing.data = data; existing.binary = binary; existing.mtime = this.clock(); existing.attr |= ATTR.A;
      } else parent.children.set(name, makeFile(name, this.clock(), data, binary));
      this.save();
    }

    /** 写入文本文件 */
    writeText(path, text, opts = {}) { this._write(path, String(text), false, !!opts.append); }

    /** 写入二进制文件（Base64 存储） */
    writeBytes(path, bytes) { this._write(path, b64.encode(bytes), true, false); }

    /** 复制文件（保留二进制属性） */
    copyFile(src, dest) {
      const s = this.stat(src);
      if (!s) throw new FsError('NOT_FOUND');
      if (s.type === 'dir') throw new FsError('IS_DIR');
      if (s.node.binary) this._write(dest, s.node.data, true, false);
      else this._write(dest, s.node.data, false, false);
    }

    /** 删除文件 */
    unlink(path) {
      const loc = this.resolve(path);
      const n = this._nodeAt(loc);
      if (!n) throw new FsError('NOT_FOUND');
      if (n.type === 'dir') throw new FsError('ACCESS_DENIED');
      if (n.attr & ATTR.R) throw new FsError('ACCESS_DENIED');
      this._parentOf(loc).parent.children.delete(loc.parts[loc.parts.length - 1]);
      this.save();
    }

    /** 创建目录 */
    mkdir(path) {
      const loc = this.resolve(path);
      if (!loc.parts.length) throw new FsError('EXISTS');
      const { parent, name } = this._parentOf(loc);
      if (!FileSystem.validName(name)) throw new FsError('INVALID_NAME');
      if (parent.children.has(name)) throw new FsError('EXISTS');
      this._checkSpace(loc.drive, 2048);
      parent.children.set(name, makeDir(name, this.clock()));
      this.save();
    }

    /** 删除目录；recursive 时删除整棵子树 */
    rmdir(path, opts = {}) {
      const loc = this.resolve(path);
      if (!loc.parts.length) throw new FsError('NOT_EMPTY');
      const n = this._nodeAt(loc);
      if (!n || n.type !== 'dir') throw new FsError('NOT_EMPTY');
      if (n.children.size && !opts.recursive) throw new FsError('NOT_EMPTY');
      const cur = this.cwd[loc.drive];
      if (cur.length >= loc.parts.length && loc.parts.every((p, i) => cur[i] === p)) throw new FsError('CURRENT_DIR', 'Attempt to remove current directory');
      this._parentOf(loc).parent.children.delete(loc.parts[loc.parts.length - 1]);
      this.save();
    }

    /** 同目录改名（文件或目录） */
    rename(path, newName) {
      const loc = this.resolve(path);
      const n = this._nodeAt(loc);
      if (!n || !loc.parts.length) throw new FsError('NOT_FOUND');
      newName = newName.toUpperCase().replace(/\.$/, '');
      if (!FileSystem.validName(newName)) throw new FsError('INVALID_NAME');
      const { parent, name } = this._parentOf(loc);
      if (parent.children.has(newName) && newName !== name) throw new FsError('EXISTS');
      // 保持原有顺序：重建 Map
      const entries = Array.from(parent.children.entries()).map(([k, v]) => k === name ? [newName, v] : [k, v]);
      n.name = newName;
      parent.children = new Map(entries);
      this.save();
    }

    /** 移动文件或目录到新位置（目标为完整路径） */
    move(src, dest) {
      const sl = this.resolve(src), dl = this.resolve(dest);
      const n = this._nodeAt(sl);
      if (!n || !sl.parts.length) throw new FsError('NOT_FOUND');
      if (n.type === 'dir' && dl.drive === sl.drive && dl.parts.length > sl.parts.length && sl.parts.every((p, i) => dl.parts[i] === p)) throw new FsError('ACCESS_DENIED');
      const { parent: dp, name } = this._parentOf(dl);
      if (!FileSystem.validName(name)) throw new FsError('INVALID_NAME');
      const existing = dp.children.get(name);
      if (existing && existing !== n) {
        if (existing.type === 'dir' || n.type === 'dir' || (existing.attr & ATTR.R)) throw new FsError('ACCESS_DENIED');
      }
      if (sl.drive !== dl.drive) {
        const sz = n.type === 'file' ? sizeOf(n) : 0;
        this._checkSpace(dl.drive, sz);
      }
      this._parentOf(sl).parent.children.delete(sl.parts[sl.parts.length - 1]);
      n.name = name;
      dp.children.set(name, n);
      this.save();
    }

    /** 修改属性：changes 形如 {R:true, H:false} */
    setAttr(path, changes) {
      const s = this.stat(path);
      if (!s) throw new FsError('NOT_FOUND');
      for (const k of Object.keys(changes)) {
        if (!ATTR[k] || k === 'D') continue;
        if (changes[k]) s.node.attr |= ATTR[k]; else s.node.attr &= ~ATTR[k];
      }
      this.save();
    }

    // ---------------- 当前目录/盘符 ----------------

    /** 切换当前目录 */
    chdir(path) {
      const loc = this.resolve(path);
      if (!this._dirAt(loc.drive, loc.parts)) throw new FsError('NOT_DIR');
      this.cwd[loc.drive] = loc.parts;
      this.save();
    }

    /** 当前目录字符串 */
    getCwd(drive = this.curDrive) {
      if (!this.drives[drive]) throw new FsError('INVALID_DRIVE');
      return drive + ':\\' + this.cwd[drive].join('\\');
    }

    /** 切换当前盘符 */
    setDrive(letter) {
      letter = letter.toUpperCase();
      if (!this.drives[letter]) throw new FsError('INVALID_DRIVE');
      this.curDrive = letter;
      this.save();
    }

    /** 格式化：清空整个盘符；opts.label 设置卷标，opts.files 写入系统文件 */
    formatDrive(letter, opts = {}) {
      letter = letter.toUpperCase();
      const d = this.drives[letter];
      if (!d) throw new FsError('INVALID_DRIVE');
      d.root = makeDir('', this.clock());
      d.label = (opts.label || '').toUpperCase().slice(0, 11);
      d.serial = this._serial();
      d.created = this.clock();
      this.cwd[letter] = [];
      if (opts.files) this._populate(d.root, opts.files);
      this.save();
    }

    /** 设置卷标 */
    setLabel(letter, label) {
      const d = this.drives[letter.toUpperCase()];
      if (!d) throw new FsError('INVALID_DRIVE');
      d.label = String(label || '').toUpperCase().slice(0, 11);
      this.save();
    }
  }

  FileSystem.ATTR = ATTR;
  FileSystem.MESSAGES = MESSAGES;
  FileSystem.wildMatch = wildMatch;
  FileSystem.base64 = b64;
  DOS.FileSystem = FileSystem;
  DOS.FsError = FsError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
