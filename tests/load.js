/*
 * 在 Node 中加载全部模块（不含 main.js），供测试脚本使用。
 */
'use strict';
const path = require('path');
const FILES = ['font', 'terminal', 'input', 'filesystem', 'disk-image', 'parser', 'batch', 'commands',
  'graphics', 'audio', 'programs', 'mario-data', 'mario', 'machine'];
for (const f of FILES) require(path.join(__dirname, '..', 'js', f + '.js'));

/** 简易内存 storage（模拟 localStorage） */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

module.exports = { DOS: globalThis.DOS, MemoryStorage };
