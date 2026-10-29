/*
 * MarioGame —— MARIO.COM：状态、物理、关卡构建、渲染与宿主循环
 * ---------------------------------------------------------------
 * 致敬性的原创实现，与任天堂无关联（详见 mario-data.js 顶部说明）。
 *
 * 结构：
 *   MarioGame      只处理状态与物理：step(input) 推进一个逻辑帧（1/60 秒），
 *                  产生的声音/音乐/播报以事件形式放入 game.events，由宿主消费。
 *   MarioRenderer  只读取 MarioGame 的状态并绘制到 Graphics 后台缓冲。
 *   MarioProgram   宿主：固定时间步长循环（逻辑与渲染分离）、键盘映射、音频。
 *
 * 分辨率取舍：采用 NES 原生 256×240，而不是缩放进 320×200。
 *   - 缩放到 200 行会破坏 16px 图块的像素网格（非整数比例）；
 *   - 裁剪 40 行会丢失 HUD 或地面。
 *   因此 MARIO 以 Mode 13h 的 256 色索引方式渲染到 256×240 缓冲，
 *   界面层按整数倍缩放并居中（letterbox 黑边），保持像素比例。
 *
 * 坐标：像素，原点在关卡左上角；马里奥的 x/y 为碰撞盒左上角。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const TS = 16;          // 图块尺寸
  const SCREEN_W = 256;
  const SCREEN_H = 240;

  /** 图块类型 */
  const T = {
    EMPTY: 0, GROUND: 1, BRICK: 2, QUESTION: 3, USED: 4, HARD: 5,
    PIPE_TL: 6, PIPE_TR: 7, PIPE_BL: 8, PIPE_BR: 9, HIDDEN: 10,
    POLE: 11, POLE_TOP: 12, CASTLE: 13, CASTLE_TOP: 14, CASTLE_ARCH: 15, CASTLE_DOOR: 16, CASTLE_WINDOW: 17,
    COIN: 18, SPIPE_MT: 19, SPIPE_MB: 20, SPIPE_BT: 21, SPIPE_BB: 22
  };
  const SOLID = new Set([T.GROUND, T.BRICK, T.QUESTION, T.USED, T.HARD, T.PIPE_TL, T.PIPE_TR, T.PIPE_BL, T.PIPE_BR, T.SPIPE_MT, T.SPIPE_MB, T.SPIPE_BT, T.SPIPE_BB]);
  const BLOCK_CODES = { B: T.BRICK, '?': T.QUESTION, H: T.HIDDEN, U: T.USED, X: T.HARD, C: T.COIN };
  const COMBO = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];

  const SMALL_H = 15, BIG_H = 31, MARIO_W = 12;
  const EPS = 0.01; // 计算碰撞盒覆盖的图块范围时用的边缘容差（支持亚像素位置）

  /** 轴对齐包围盒相交 */
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /**
   * 由关卡描述构建区域（图块网格、内容、敌人出生点）。
   * @param {object} def LEVEL.areas 中的一项
   * @param {string} id
   */
  function buildArea(def, id) {
    const w = def.width, h = 15;
    const grid = new Uint8Array(w * h);
    const set = (x, y, t) => { if (x >= 0 && x < w && y >= 0 && y < h) grid[y * w + x] = t; };
    for (const [a, b] of def.ground || []) for (let x = a; x <= b; x++) { set(x, 13, T.GROUND); set(x, 14, T.GROUND); }
    for (const [x, height] of def.pipes || []) {
      const top = 13 - height;
      set(x, top, T.PIPE_TL); set(x + 1, top, T.PIPE_TR);
      for (let y = top + 1; y <= 12; y++) { set(x, y, T.PIPE_BL); set(x + 1, y, T.PIPE_BR); }
    }
    const contents = new Map();
    for (const [x, y, code, content] of def.blocks || []) {
      set(x, y, BLOCK_CODES[code]);
      if (content) contents.set(x + ',' + y, content);
    }
    for (const [x, height] of def.stairs || []) for (let y = 13 - height; y <= 12; y++) set(x, y, T.HARD);
    if (def.flag) {
      set(def.flag.x, def.flag.top, T.POLE_TOP);
      for (let y = def.flag.top + 1; y <= 11; y++) set(def.flag.x, y, T.POLE);
      set(def.flag.x, 12, T.HARD);
    }
    if (def.castle) {
      const cx = def.castle.x;
      // 两层小城堡：上层 3 格宽，下层 5 格宽
      for (let i = 1; i <= 3; i++) set(cx + i, 8, T.CASTLE_TOP);
      set(cx + 1, 9, T.CASTLE_WINDOW); set(cx + 2, 9, T.CASTLE); set(cx + 3, 9, T.CASTLE_WINDOW);
      for (let i = 0; i <= 4; i++) set(cx + i, 10, i === 0 || i === 4 ? T.CASTLE_TOP : T.CASTLE);
      for (let i = 0; i <= 4; i++) set(cx + i, 11, i === 2 ? T.CASTLE_ARCH : T.CASTLE);
      for (let i = 0; i <= 4; i++) set(cx + i, 12, i === 2 ? T.CASTLE_DOOR : T.CASTLE);
    }
    if (def.sidePipe) {
      const sp = def.sidePipe;
      set(sp.x, sp.y, T.SPIPE_MT); set(sp.x, sp.y + 1, T.SPIPE_MB);
      set(sp.x + 1, sp.y, T.SPIPE_BT); set(sp.x + 1, sp.y + 1, T.SPIPE_BB);
      for (let y = 0; y < sp.y; y++) { set(sp.column - 1, y, T.PIPE_BL); set(sp.column, y, T.PIPE_BR); }
      set(sp.column, sp.y, T.PIPE_BR); set(sp.column, sp.y + 1, T.PIPE_BR);
    }
    return {
      id, def, w, h, grid, contents,
      theme: def.theme || 'overworld',
      multi: new Map(),
      // 出生点按 x 排序，spawnIdx 指向下一个待生成的敌人（克隆时只需复制这个整数）
      spawns: (def.enemies || []).map(([kind, x, y]) => ({ kind, x: x * TS, y: y * TS })).sort((p, q) => p.x - q.x),
      spawnIdx: 0,
      // get/set 通过 this.grid 访问，克隆区域时只需复制 grid
      get(x, y) { return x < 0 || x >= this.w || y < 0 || y >= this.h ? T.EMPTY : this.grid[y * this.w + x]; },
      set(x, y, t) { if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.grid[y * this.w + x] = t; }
    };
  }

  class MarioGame {
    /**
     * @param {{data?:object, level?:object, hiscore?:number, lives?:number, autoStart?:boolean}} [opts]
     *   autoStart = true 时跳过标题与过场直接进入游戏（测试用）。
     */
    constructor(opts = {}) {
      this.data = opts.data || DOS.MarioData;
      this.P = this.data.PHYSICS;
      this.levelDef = opts.level || this.data.LEVEL;
      this.hiscore = opts.hiscore || 0;
      this.startLives = opts.lives || 3;
      this.events = [];
      this.frame = 0;
      this.prev = {};
      this.paused = false;
      this.state = 'title';
      this.timer = 0;
      this.lives = this.startLives;
      this.score = 0;
      this.coins = 0;
      this.loadLevel();
      if (opts.autoStart) this.startGame(true);
    }

    // ---------------- 事件 ----------------

    _emit(type, name, extra) { if (!this.silent) this.events.push(Object.assign({ type, name }, extra || {})); }

    /**
     * 深拷贝可变状态，得到一个可独立推进的“前向模型”（供自动驾驶搜索使用）。
     * 克隆体不产生事件（silent），关卡定义等只读数据共享。
     * @returns {MarioGame}
     */
    clone() {
      const g = Object.create(MarioGame.prototype);
      Object.assign(g, this);
      g.silent = true;
      g.events = [];
      g.areas = {};
      for (const id of Object.keys(this.areas)) {
        const a = this.areas[id];
        // grid/multi 与原对象共享，直到克隆体修改图块（见 _mutArea）；contents、spawns 只读
        g.areas[id] = Object.assign({}, a, { shared: true });
      }
      g.area = g.areas[this.area.id];
      g.mario = Object.assign({}, this.mario);
      g.enemies = this.enemies.map(e => Object.assign({}, e));
      g.items = this.items.map(i => Object.assign({}, i));
      g.effects = [];
      g.bumps = this.bumps.map(b => Object.assign({}, b));
      g.flag = this.flag && Object.assign({}, this.flag);
      g.prev = Object.assign({}, this.prev);
      g.transform = this.transform && Object.assign({}, this.transform);
      g.pipe = this.pipe && Object.assign({}, this.pipe);
      return g;
    }
    _sfx(name) { this._emit('sfx', name); }
    _music(name, extra) { this._emit('music', name, extra); }
    _announce(text) { this._emit('announce', text); }

    // ---------------- 流程 ----------------

    /** 开始新游戏 */
    startGame(skipIntro) {
      this.lives = this.startLives;
      this.score = 0;
      this.coins = 0;
      this.startLevel(skipIntro);
    }

    /** 开始（或重新开始）本关 */
    startLevel(skipIntro) {
      this.loadLevel();
      this.paused = false;
      if (skipIntro) { this.state = 'play'; this._music('start'); }
      else { this.state = 'intro'; this.timer = 0; this._announce(`World ${this.levelDef.name}. Lives ${this.lives}.`); }
    }

    /** 构建关卡与马里奥初始状态 */
    loadLevel() {
      this.areas = {};
      for (const id of Object.keys(this.levelDef.areas)) this.areas[id] = buildArea(this.levelDef.areas[id], id);
      this.area = this.areas.main;
      this.time = this.levelDef.time || 400;
      this.timeTick = 0;
      this.hurry = false;
      this.camX = 0;
      this.enemies = [];
      this.items = [];
      this.effects = [];
      this.bumps = [];
      this.combo = 0;
      const flag = this.area.def.flag;
      this.flag = flag ? { x: flag.x, top: flag.top, y: (flag.top + 1) * TS, stage: null, timer: 0 } : null;
      this.mario = this._newMario(this.levelDef.start.x, this.levelDef.start.bottom);
      this._spawnEnemies();
    }

    _newMario(x, bottom) {
      return {
        x, y: bottom - SMALL_H, w: MARIO_W, h: SMALL_H,
        vx: 0, vy: 0, big: false, facing: 1, onGround: true, jumping: false, holdJump: false,
        gHold: this.P.jump[0].hold, gFall: this.P.jump[0].fall, airMax: this.P.maxWalk,
        crouch: false, skid: false, invuln: 0, star: 0, anim: 0, dead: false, hidden: false, behind: false, prevBottom: 0
      };
    }

    /**
     * 推进一个逻辑帧。
     * @param {{left?:boolean,right?:boolean,up?:boolean,down?:boolean,a?:boolean,b?:boolean,start?:boolean}} input
     */
    step(input = {}) {
      const pressed = (k) => !!input[k] && !this.prev[k];
      this.frame++;
      switch (this.state) {
        case 'title':
          if (pressed('start') || pressed('a')) this.startGame(false);
          break;
        case 'intro':
          if (++this.timer >= 150) { this.state = 'play'; this._music('start'); }
          break;
        case 'play':
          if (pressed('start')) {
            this.paused = !this.paused;
            this._sfx('pause');
            this._music(this.paused ? 'pause' : 'resume');
          }
          if (!this.paused) this._updatePlay(input, pressed);
          break;
        case 'transform': this._updateTransform(); break;
        case 'dying': this._updateDying(); break;
        case 'pipe': this._updatePipe(); break;
        case 'flag': this._updateFlag(); break;
        case 'clear':
          this.timer++;
          if (pressed('start') && this.timer > 30) this.startGame(false);
          break;
        case 'gameover':
          if (++this.timer >= 300 || (pressed('start') && this.timer > 60)) { this.state = 'title'; this.loadLevel(); }
          break;
      }
      for (const b of this.bumps) b.t++;
      this.bumps = this.bumps.filter(b => b.t < 12);
      this.prev = Object.assign({}, input);
    }

    // ---------------- 图块查询 ----------------

    _tileAt(px, py) { return this.area.get(Math.floor(px / TS), Math.floor(py / TS)); }

    /** 是否为实心图块；关卡左右边界外视为墙，上下边界外为空 */
    _solid(tx, ty) {
      if (tx < 0 || tx >= this.area.w) return ty < 15;
      return SOLID.has(this.area.get(tx, ty));
    }

    // ---------------- 游戏主循环（play） ----------------

    _updatePlay(input, pressed) {
      const m = this.mario;
      if (++this.timeTick >= this.P.timeTick) {
        this.timeTick = 0;
        if (this.time > 0) this.time--;
        if (this.time === 100 && !this.hurry) { this.hurry = true; this._sfx('warning'); this._music('speed', { speed: 1.35 }); }
        if (this.time <= 0) { this._killMario(false); return; }
      }
      if (m.invuln > 0) m.invuln--;
      if (m.star > 0) m.star--;
      this._updateMario(input, pressed);
      if (this.state !== 'play') return;
      this._spawnEnemies();
      this._updateEnemies();
      this._updateItems();
      this._updateEffects();
      this._collideMario();
      if (this.state !== 'play') return;
      this._collectCoins();
      this._updateCamera();
      this._checkSpecial(input);
    }

    /** 根据水平速度选择跳跃档位 */
    _jumpBand(speed) {
      const J = this.P.jump;
      return speed < J[0].below ? J[0] : speed < J[1].below ? J[1] : J[2];
    }

    _updateMario(input, pressed) {
      const m = this.mario, P = this.P;
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      // 蹲下（仅大体、在地面）
      if (m.onGround) {
        const want = m.big && !!input.down;
        if (want && !m.crouch) { m.crouch = true; m.y += BIG_H - SMALL_H; m.h = SMALL_H; }
        else if (!want && m.crouch && !this._ceilingBlocked(m.x, m.y + m.h - BIG_H, m.w)) { m.crouch = false; m.y -= BIG_H - SMALL_H; m.h = BIG_H; }
      }
      if (m.onGround) {
        const eff = m.crouch ? 0 : dir;
        const band = this._jumpBand(Math.abs(m.vx));
        m.gFall = band.fall;
        if (eff !== 0) {
          if (m.vx !== 0 && Math.sign(m.vx) !== eff) {
            // 反向：滑行减速（skid）
            m.skid = true;
            m.facing = eff;
            m.vx += eff * P.skidDecel;
            if (Math.sign(m.vx) === eff || Math.abs(m.vx) < P.skidTurn) m.vx = 0;
          } else {
            m.skid = false;
            m.facing = eff;
            const max = input.b ? P.maxRun : P.maxWalk;
            const accel = input.b ? P.runAccel : P.walkAccel;
            const s = Math.abs(m.vx);
            if (s < P.minWalk) m.vx = eff * P.minWalk;
            else if (s < max) m.vx = eff * Math.min(max, s + accel);
            else if (s > max) m.vx = eff * Math.max(max, s - P.releaseDecel);
          }
        } else {
          m.skid = false;
          const s = Math.abs(m.vx);
          m.vx = s <= P.releaseDecel ? 0 : m.vx - Math.sign(m.vx) * P.releaseDecel;
        }
        if (pressed('a')) {
          const s = Math.abs(m.vx);
          const j = this._jumpBand(s);
          m.vy = j.v;
          m.gHold = j.hold;
          m.gFall = j.fall;
          m.jumping = true;
          m.holdJump = true;
          m.onGround = false;
          m.skid = false;
          m.airMax = s > P.maxWalk ? P.maxRun : P.maxWalk;
          m.takeoff = true;
          this._sfx(m.big ? 'jumpBig' : 'jump');
        }
      } else if (dir !== 0) {
        // 空中控制：保持惯性，方向键只能缓慢改变速度
        const s = Math.abs(m.vx);
        const accel = s >= P.maxWalk ? P.runAccel : P.walkAccel;
        m.vx = Math.max(-m.airMax, Math.min(m.airMax, m.vx + dir * accel));
      }
      // 重力：按住 A 且仍在上升时使用较小的重力，否则使用下落重力
      m.holdJump = m.holdJump && !!input.a;
      const g = m.holdJump && m.vy < 0 ? m.gHold : m.gFall;
      // 起跳帧以完整初速度移动（与原版一致：静止起跳约 66px，刚好越过 4 格高的水管）
      if (m.takeoff) m.takeoff = false;
      else m.vy = Math.min(P.maxFall, m.vy + g);
      this._moveMario();
      // 走路动画
      if (m.onGround) m.anim += Math.abs(m.vx) * 0.1 + (m.vx ? 0.05 : 0);
    }

    _ceilingBlocked(x, y, w) {
      const ty = Math.floor(y / TS);
      for (let tx = Math.floor(x / TS); tx <= Math.floor((x + w - EPS) / TS); tx++) if (this._solid(tx, ty)) return true;
      return false;
    }

    /** 先水平后垂直移动，分别处理碰撞（AABB vs 图块） */
    _moveMario() {
      const m = this.mario;
      m.prevBottom = m.y + m.h;
      // 水平
      m.x += m.vx;
      const top = Math.floor(m.y / TS), bottom = Math.floor((m.y + m.h - EPS) / TS);
      if (m.vx > 0) {
        const tx = Math.floor((m.x + m.w - EPS) / TS);
        for (let ty = top; ty <= bottom; ty++) if (this._solid(tx, ty)) { m.x = tx * TS - m.w; m.vx = 0; break; }
      } else if (m.vx < 0) {
        const tx = Math.floor(m.x / TS);
        for (let ty = top; ty <= bottom; ty++) if (this._solid(tx, ty)) { m.x = (tx + 1) * TS; m.vx = 0; break; }
      }
      // 屏幕左缘（不能回头滚动）
      if (m.x < this.camX) { m.x = this.camX; if (m.vx < 0) m.vx = 0; }
      // 垂直
      m.y += m.vy;
      const left = Math.floor(m.x / TS), right = Math.floor((m.x + m.w - EPS) / TS);
      m.onGround = false;
      if (m.vy >= 0) {
        const ty = Math.floor((m.y + m.h - EPS) / TS);
        for (let tx = left; tx <= right; tx++) {
          if (this._solid(tx, ty) && m.prevBottom <= ty * TS + 0.01) {
            m.y = ty * TS - m.h;
            m.vy = 0;
            m.onGround = true;
            m.jumping = false;
            this.combo = 0;
            break;
          }
        }
      } else {
        const ty = Math.floor(m.y / TS);
        const hits = [];
        for (let tx = left; tx <= right; tx++) {
          const t = this.area.get(tx, ty);
          if (this._solid(tx, ty) || (t === T.HIDDEN && m.y - m.vy >= (ty + 1) * TS - 0.01)) hits.push(tx);
        }
        if (hits.length) {
          const cx = Math.floor((m.x + m.w / 2) / TS);
          const tx = hits.includes(cx) ? cx : hits[0];
          m.y = (ty + 1) * TS;
          m.vy = 1;
          m.holdJump = false;
          this._hitBlock(tx, ty);
        }
      }
    }

    // ---------------- 方块 ----------------

    _bump(tx, ty) {
      this.bumps.push({ tx, ty, t: 0 });
      const box = { x: tx * TS, y: ty * TS - 4, w: TS, h: 4 };
      for (const e of this.enemies) {
        if (e.state !== 'dead' && overlap(box, { x: e.x, y: e.y + e.h - 2, w: e.w, h: 2 })) this._killEnemy(e, 100);
      }
      for (const it of this.items) {
        if ((it.kind === 'mushroom' || it.kind === 'oneup') && !it.rising && overlap(box, { x: it.x, y: it.y + 12, w: 16, h: 4 })) {
          it.vy = -3.5;
          it.vx = (it.x + 8 < tx * TS + 8) ? -Math.abs(it.vx) : Math.abs(it.vx);
        }
      }
    }

    /** 写时复制：克隆体第一次修改图块前才真正复制当前区域的 grid */
    _mutArea() {
      const a = this.area;
      if (!a.shared) return a;
      const c = Object.assign({}, a, { grid: a.grid.slice(), multi: new Map(Array.from(a.multi, ([k, v]) => [k, Object.assign({}, v)])), shared: false });
      this.areas[a.id] = c;
      this.area = c;
      return c;
    }

    _hitBlock(tx, ty) {
      const a = this._mutArea(), t = a.get(tx, ty), key = tx + ',' + ty, content = a.contents.get(key);
      if (t === T.QUESTION || t === T.HIDDEN) {
        a.set(tx, ty, T.USED);
        this._bump(tx, ty);
        this._spawnContent(content || 'coin', tx, ty);
      } else if (t === T.BRICK) {
        if (content === 'coins') {
          const st = a.multi.get(key) || { count: 0, start: this.frame };
          st.count++;
          a.multi.set(key, st);
          this._bump(tx, ty);
          this._spawnContent('coin', tx, ty);
          if (st.count >= 10 || this.frame - st.start > 240) a.set(tx, ty, T.USED);
        } else if (content) {
          a.set(tx, ty, T.USED);
          this._bump(tx, ty);
          this._spawnContent(content, tx, ty);
        } else if (this.mario.big) {
          a.set(tx, ty, T.EMPTY);
          const x = tx * TS, y = ty * TS;
          for (const [dx, dy, vx, vy] of [[0, 0, -1, -5], [8, 0, 1, -5], [0, 8, -1, -3.5], [8, 8, 1, -3.5]]) {
            this.effects.push({ kind: 'debris', x: x + dx, y: y + dy, vx, vy, t: 0 });
          }
          this._addScore(50);
          this._sfx('break');
          this._bump(tx, ty);
        } else {
          this._bump(tx, ty);
          this._sfx('bump');
        }
      } else this._sfx('bump');
    }

    _spawnContent(content, tx, ty) {
      const x = tx * TS, y = ty * TS;
      if (content === 'coin') {
        this.effects.push({ kind: 'coinpop', x, y: y - TS, vy: -5, t: 0 });
        this._addCoin();
        this._addScore(200, false);
        this._sfx('coin');
      } else {
        const kind = content === '1up' ? 'oneup' : content === 'star' ? 'star' : 'mushroom';
        this.items.push({ kind, x, y, w: 16, h: 16, vx: this.P.itemSpeed, vy: 0, rising: TS, startY: y });
        this._sfx('sprout');
      }
    }

    _addCoin() {
      this.coins++;
      if (this.coins >= 100) { this.coins -= 100; this._oneUp(); }
    }

    _oneUp() {
      this.lives++;
      this._sfx('oneup');
      this._announce(`One up. Lives ${this.lives}.`);
    }

    _addScore(points, popup = true, x, y) {
      this.score += points;
      if (popup) {
        const m = this.mario;
        this.effects.push({ kind: 'popup', text: String(points), x: x === undefined ? m.x : x, y: y === undefined ? m.y - 8 : y, t: 0 });
      }
    }

    // ---------------- 敌人 ----------------

    _spawnEnemies() {
      const a = this.area;
      while (a.spawnIdx < a.spawns.length && a.spawns[a.spawnIdx].x <= this.camX + SCREEN_W + 16) {
        const s = a.spawns[a.spawnIdx++];
        if (s.x + 16 < this.camX) continue;
        this.enemies.push({ kind: s.kind, x: s.x, y: s.y, w: 16, h: 16, vx: -this.P.enemySpeed, vy: 0, state: 'walk', timer: 0, grace: 0 });
      }
    }

    /** 敌人/道具共用：带重力的移动与图块碰撞，撞墙时反向 */
    _moveBody(b, gravity, maxFall) {
      b.vy = Math.min(maxFall, b.vy + gravity);
      b.x += b.vx;
      const top = Math.floor(b.y / TS), bottom = Math.floor((b.y + b.h - EPS) / TS);
      if (b.vx > 0) {
        const tx = Math.floor((b.x + b.w - EPS) / TS);
        for (let ty = top; ty <= bottom; ty++) if (this._solid(tx, ty)) { b.x = tx * TS - b.w; b.vx = -b.vx; b.hitWall = true; break; }
      } else if (b.vx < 0) {
        const tx = Math.floor(b.x / TS);
        for (let ty = top; ty <= bottom; ty++) if (this._solid(tx, ty)) { b.x = (tx + 1) * TS; b.vx = -b.vx; b.hitWall = true; break; }
      }
      const prevBottom = b.y + b.h;
      b.y += b.vy;
      b.onGround = false;
      if (b.vy >= 0) {
        const ty = Math.floor((b.y + b.h - EPS) / TS);
        for (let tx = Math.floor(b.x / TS); tx <= Math.floor((b.x + b.w - EPS) / TS); tx++) {
          if (this._solid(tx, ty) && prevBottom <= ty * TS + 0.01) { b.y = ty * TS - b.h; b.vy = 0; b.onGround = true; break; }
        }
      }
    }

    _updateEnemies() {
      const P = this.P;
      for (const e of this.enemies) {
        if (e.grace > 0) e.grace--;
        switch (e.state) {
          case 'walk':
            this._moveBody(e, P.enemyGravity, 4);
            break;
          case 'flat':
            if (++e.timer > 30) e.remove = true;
            break;
          case 'shell':
            this._moveBody(e, P.enemyGravity, 4);
            if (++e.timer > 360) { e.state = 'walk'; e.vx = (this.mario.x < e.x ? -1 : 1) * P.enemySpeed; e.timer = 0; }
            break;
          case 'shellMove':
            this._moveBody(e, P.enemyGravity, 4);
            if (e.hitWall) { e.hitWall = false; this._sfx('bump'); }
            break;
          case 'dead':
            e.vy += 0.3;
            e.x += e.vx;
            e.y += e.vy;
            break;
        }
        e.hitWall = false;
        if (e.y > SCREEN_H + 32 || e.x < this.camX - 96 || e.x > this.camX + SCREEN_W + 160) e.remove = true;
      }
      // 敌人之间：移动的龟壳击杀；普通敌人相撞互相掉头
      const list = this.enemies.filter(e => !e.remove && e.state !== 'dead' && e.state !== 'flat');
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.state === 'dead' || b.state === 'dead' || !overlap(a, b)) continue;
          if (a.state === 'shellMove' && b.state !== 'shellMove') { this._killEnemy(b, this._shellCombo(a), true); continue; }
          if (b.state === 'shellMove' && a.state !== 'shellMove') { this._killEnemy(a, this._shellCombo(b), true); continue; }
          if (a.state === 'shellMove' && b.state === 'shellMove') { this._killEnemy(a, 500, true); this._killEnemy(b, 500, true); continue; }
          if (a.state === 'walk' && b.state === 'walk') {
            if (a.x < b.x) { a.vx = -Math.abs(a.vx); b.vx = Math.abs(b.vx); }
            else { a.vx = Math.abs(a.vx); b.vx = -Math.abs(b.vx); }
          }
        }
      }
      this.enemies = this.enemies.filter(e => !e.remove);
    }

    _shellCombo(shell) {
      shell.combo = (shell.combo || 0) + 1;
      return COMBO[Math.min(COMBO.length - 1, 2 + shell.combo)];
    }

    /** 击杀敌人（翻转下落） */
    _killEnemy(e, points, shell) {
      if (e.state === 'dead') return;
      e.state = 'dead';
      e.vy = -3;
      e.vx = shell ? Math.sign(e.vx || 1) * 0.6 : 0.6;
      this._addScore(points, true, e.x, e.y - 8);
      this._sfx('kick');
    }

    // ---------------- 道具与特效 ----------------

    _updateItems() {
      const P = this.P;
      for (const it of this.items) {
        if (it.rising > 0) {
          it.y -= 0.5;
          it.rising -= 0.5;
          if (it.rising <= 0) { it.rising = 0; it.y = it.startY - TS; }
          continue;
        }
        if (it.kind === 'star') {
          this._moveBody(it, 0.2, 4);
          if (it.onGround) it.vy = -5;
        } else this._moveBody(it, 0.25, 4);
        if (it.y > SCREEN_H + 32 || it.x < this.camX - 64) it.remove = true;
      }
      this.items = this.items.filter(i => !i.remove);
    }

    _updateEffects() {
      for (const f of this.effects) {
        f.t++;
        if (f.kind === 'coinpop') {
          f.y += f.vy;
          f.vy += 0.38;
          if (f.t >= 28) { f.remove = true; this.effects.push({ kind: 'popup', text: '200', x: f.x, y: f.y, t: 0 }); }
        } else if (f.kind === 'debris') {
          f.x += f.vx; f.y += f.vy; f.vy += 0.35;
          if (f.y > SCREEN_H + 16) f.remove = true;
        } else if (f.kind === 'popup') {
          f.y -= 0.8;
          if (f.t > 40) f.remove = true;
        }
      }
      this.effects = this.effects.filter(f => !f.remove);
    }

    // ---------------- 马里奥碰撞 ----------------

    /** 收集与马里奥重叠的金币图块（地下奖励房） */
    _collectCoins() {
      const m = this.mario;
      for (let ty = Math.floor(m.y / TS); ty <= Math.floor((m.y + m.h - EPS) / TS); ty++) {
        for (let tx = Math.floor(m.x / TS); tx <= Math.floor((m.x + m.w - EPS) / TS); tx++) {
          if (this.area.get(tx, ty) !== T.COIN) continue;
          this._mutArea().set(tx, ty, T.EMPTY);
          this._addCoin();
          this._addScore(200, false);
          this._sfx('coin');
        }
      }
    }

    _collideMario() {
      const m = this.mario, P = this.P;
      for (const it of this.items) {
        if (it.rising || !overlap(m, it)) continue;
        it.remove = true;
        if (it.kind === 'mushroom') {
          this._addScore(1000);
          this._sfx('powerup');
          if (!m.big) this._startTransform('grow');
        } else if (it.kind === 'oneup') {
          this.effects.push({ kind: 'popup', text: '1UP', x: m.x, y: m.y - 8, t: 0 });
          this._oneUp();
        } else if (it.kind === 'star') {
          this._addScore(1000);
          this._sfx('powerup');
          m.star = P.starFrames;
        }
      }
      this.items = this.items.filter(i => !i.remove);
      if (this.state !== 'play') return;
      for (const e of this.enemies) {
        if (e.state === 'dead' || e.state === 'flat' || !overlap(m, e)) continue;
        if (m.star > 0) { this._killEnemy(e, 200); continue; }
        const stomp = m.vy > 0 && m.prevBottom <= e.y + 8;
        if (e.state === 'shell') {
          e.state = 'shellMove';
          e.vx = (m.x + m.w / 2 < e.x + e.w / 2 ? 1 : -1) * P.shellSpeed;
          e.grace = 12;
          e.combo = 0;
          this._addScore(400, true, e.x, e.y - 8);
          this._sfx('kick');
          if (stomp) this._bounce();
          else m.x = e.vx > 0 ? Math.min(m.x, e.x - m.w) : Math.max(m.x, e.x + e.w);
          continue;
        }
        if (stomp) {
          if (e.kind === 'goomba') { e.state = 'flat'; e.timer = 0; e.vx = 0; }
          else { e.state = 'shell'; e.vx = 0; e.timer = 0; }
          const pts = this.combo < COMBO.length ? COMBO[this.combo] : 0;
          if (pts) this._addScore(pts, true, e.x, e.y - 8);
          else { this.effects.push({ kind: 'popup', text: '1UP', x: e.x, y: e.y - 8, t: 0 }); this._oneUp(); }
          this.combo++;
          this._sfx('stomp');
          this._bounce();
          continue;
        }
        if (e.state === 'shellMove' && e.grace > 0) continue;
        this._hurtMario();
        if (this.state !== 'play') return;
      }
    }

    /** 踩踏后的弹跳：按住 A 可弹得更高 */
    _bounce() {
      const m = this.mario;
      m.vy = this.P.stompBounce;
      m.holdJump = true; // 下一帧若未按住 A 会立即切换为下落重力
      m.gHold = this.P.jump[0].hold;
      m.jumping = true;
      m.onGround = false;
    }

    _hurtMario() {
      const m = this.mario;
      if (m.invuln > 0 || m.star > 0) return;
      if (m.big) {
        this._sfx('pipe');
        this._startTransform('shrink');
      } else this._killMario(false);
    }

    _startTransform(kind) {
      this.state = 'transform';
      this.transform = { kind, t: 0 };
    }

    _updateTransform() {
      const m = this.mario, tr = this.transform;
      if (++tr.t < 60) return;
      if (tr.kind === 'grow') {
        if (!m.big) { m.big = true; m.y -= BIG_H - SMALL_H; m.h = BIG_H; }
      } else {
        m.big = false;
        if (m.crouch) m.crouch = false;
        else m.y += m.h - SMALL_H;
        m.h = SMALL_H;
        m.invuln = this.P.invulnFrames;
      }
      this.transform = null;
      this.state = 'play';
    }

    /**
     * 马里奥死亡。
     * @param {boolean} pit 是否为掉坑（无弹起动画）
     */
    _killMario(pit) {
      const m = this.mario;
      this.state = 'dying';
      this.timer = 0;
      m.dead = true;
      m.pit = pit;
      m.big = false;
      if (m.h !== SMALL_H) { m.y += m.h - SMALL_H; m.h = SMALL_H; }
      m.vx = 0;
      m.vy = 0;
      this._music('stop');
      this._sfx('death');
    }

    _updateDying() {
      const m = this.mario;
      this.timer++;
      if (!m.pit) {
        if (this.timer === 30) m.vy = -5;
        if (this.timer > 30) { m.y += m.vy; m.vy = Math.min(4, m.vy + 0.25); }
      }
      if (this.timer >= 200) {
        this.lives--;
        this.hiscore = Math.max(this.hiscore, this.score);
        if (this.lives > 0) {
          this._announce(`Lost a life. Lives ${this.lives}. Score ${this.score}.`);
          this.startLevel(false);
        } else {
          this.state = 'gameover';
          this.timer = 0;
          this._sfx('gameover');
          this._emit('hiscore', 'save', { value: this.hiscore });
          this._announce(`Game over. Score ${this.score}.`);
        }
      }
    }

    // ---------------- 镜头、坑洞、水管、旗杆 ----------------

    _updateCamera() {
      const m = this.mario;
      const maxCam = Math.max(0, this.area.w * TS - SCREEN_W);
      const target = m.x + m.w / 2 - 112;
      if (target > this.camX) this.camX = Math.min(maxCam, target);
    }

    _checkSpecial(input) {
      const m = this.mario, a = this.area;
      if (m.y > SCREEN_H) { this._killMario(true); return; }
      // 进入水管（下）
      if (input.down && m.onGround && a.def.warps) {
        for (const w of a.def.warps) {
          const px = w.x * TS;
          const top = this._pipeTop(w.x);
          if (m.x >= px + 2 && m.x + m.w <= px + 30 && Math.abs(m.y + m.h - top * TS) < 0.5) {
            if (m.crouch) { m.crouch = false; m.y -= BIG_H - SMALL_H; m.h = BIG_H; }
            this.pipe = { dir: 'down', t: 0, warp: w };
            this.state = 'pipe';
            m.behind = true;
            m.vx = 0;
            this._sfx('pipe');
            return;
          }
        }
      }
      // 侧向水管（右）
      if (input.right && m.onGround && a.def.sidePipe && m.x + m.w >= a.def.sidePipe.x * TS - 1) {
        this.pipe = { dir: 'right', t: 0 };
        this.state = 'pipe';
        m.behind = true;
        m.vx = 0;
        this._sfx('pipe');
        return;
      }
      // 旗杆
      if (this.flag && !this.flag.stage && m.x + m.w >= this.flag.x * TS + 6) this._grabFlag();
    }

    _pipeTop(x) {
      for (let y = 0; y < 15; y++) if (this.area.get(x, y) === T.PIPE_TL) return y;
      return 13;
    }

    _updatePipe() {
      const m = this.mario, p = this.pipe;
      p.t++;
      if (p.dir === 'down') {
        m.y += 1;
        if (p.t >= 36) {
          this.area = this.areas[p.warp.to];
          this.camX = 0;
          this.enemies = []; this.items = []; this.effects = [];
          m.x = p.warp.entry.x; m.y = p.warp.entry.y; m.vx = 0; m.vy = 0;
          m.behind = false;
          this.state = 'play';
        }
      } else if (p.dir === 'right') {
        m.x += 0.75;
        if (p.t >= 32) {
          const main = this.areas.main, exit = main.def.exitPipe;
          this.area = main;
          this.enemies = []; this.items = []; this.effects = [];
          const top = this._pipeTop(exit.x);
          m.x = exit.x * TS + 16 - m.w / 2;
          m.y = top * TS;
          m.vx = 0; m.vy = 0;
          this.camX = Math.max(0, Math.min(main.w * TS - SCREEN_W, exit.x * TS - 80));
          while (main.spawnIdx < main.spawns.length && main.spawns[main.spawnIdx].x < this.camX + SCREEN_W) main.spawnIdx++;
          this.pipe = { dir: 'up', t: 0, top };
          this._sfx('pipe');
        }
      } else if (p.dir === 'up') {
        m.y -= 1;
        if (m.y + m.h <= p.top * TS) {
          m.y = p.top * TS - m.h;
          m.behind = false;
          m.onGround = true;
          this.state = 'play';
        }
      }
    }

    _grabFlag() {
      const m = this.mario, f = this.flag;
      const yb = m.y + m.h;
      const pts = yb < 64 ? 5000 : yb < 96 ? 2000 : yb < 128 ? 800 : yb < 160 ? 400 : 100;
      this._addScore(pts, false);
      this.effects.push({ kind: 'flagscore', text: String(pts), x: f.x * TS + 12, y: 12 * TS, t: 0 });
      f.stage = 'slide';
      f.timer = 0;
      this.state = 'flag';
      m.x = f.x * TS + 7 - m.w;
      m.vx = 0; m.vy = 0;
      m.crouch = false;
      if (m.big && m.h !== BIG_H) m.h = BIG_H;
      this._music('stop');
      this._sfx('flagpole');
    }

    _updateFlag() {
      const m = this.mario, f = this.flag, base = 12 * TS;
      f.timer++;
      for (const e of this.effects) if (e.kind === 'flagscore' && e.y > (f.top + 1) * TS) e.y -= 2;
      if (f.stage === 'slide') {
        if (m.y + m.h < base) m.y = Math.min(base - m.h, m.y + 2);
        if (f.y < base - TS) f.y = Math.min(base - TS, f.y + 2);
        if (m.y + m.h >= base && f.y >= base - TS) { f.stage = 'turn'; f.timer = 0; m.facing = -1; m.x = f.x * TS + 9; }
      } else if (f.stage === 'turn') {
        if (f.timer >= 24) { f.stage = 'walk'; f.timer = 0; m.facing = 1; this._sfx('clear'); }
      } else if (f.stage === 'walk') {
        m.vx = 1.25;
        m.vy = Math.min(4, m.vy + 0.4);
        const saveCam = this.camX;
        this._moveMario();
        this.camX = saveCam;
        this._updateCamera();
        m.anim += 0.18;
        const door = (this.area.def.castle.x + 2) * TS + 2;
        if (m.x >= door) { m.hidden = true; f.stage = 'tally'; f.timer = 0; }
      } else if (f.stage === 'tally') {
        if (f.timer > 30) {
          if (this.time > 0) {
            const n = Math.min(this.time, 2);
            this.time -= n;
            this.score += n * 50;
            if (f.timer % 3 === 0) this._sfx('tick');
          } else { f.stage = 'done'; f.timer = 0; }
        }
      } else if (f.stage === 'done') {
        if (f.timer >= 60) {
          this.state = 'clear';
          this.timer = 0;
          this.hiscore = Math.max(this.hiscore, this.score);
          this._emit('hiscore', 'save', { value: this.hiscore });
          this._announce(`Course clear! Score ${this.score}. Press Enter to play again or Escape to exit.`);
        }
      }
      this._updateEffects();
    }
  }

  // ==================================================================
  // 渲染器：只读取 MarioGame 状态
  // ==================================================================

  class MarioRenderer {
    /**
     * @param {object} gfx DOS.Graphics
     * @param {object} [data] MarioData
     */
    constructor(gfx, data) {
      this.g = gfx;
      this.data = data || DOS.MarioData;
      this.index = {};
      for (const k of Object.keys(this.data.PALETTE)) this.index[k] = this.data.PALETTE[k][0];
      this.sprites = {};
      for (const name of Object.keys(this.data.SPRITES)) this.sprites[name] = this._compile(this.data.SPRITES[name]);
      this.remaps = {};
      for (const name of Object.keys(this.data.REMAPS)) {
        const r = new Uint8Array(256);
        for (let i = 0; i < 256; i++) r[i] = i;
        const spec = this.data.REMAPS[name];
        for (const from of Object.keys(spec)) r[this.index[from]] = this.index[spec[from]];
        this.remaps[name] = r;
      }
      this.WHITE = this.index.W;
      this.BLACK = this.index.K;
    }

    _compile(rows) {
      const h = rows.length, w = rows[0].length;
      const data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = this.index[rows[y][x]] || 0;
      return { w, h, data };
    }

    /** 写入游戏调色板（MODE 13 的 256 色索引） */
    setupPalette() {
      for (const k of Object.keys(this.data.PALETTE)) {
        const [i, hex] = this.data.PALETTE[k];
        if (i) this.g.setPaletteHex(i, hex);
      }
    }

    /** 放大文本（标题用） */
    bigText(str, x, y, c, scale) {
      for (const ch of str) {
        const glyph = DOS.Font.glyph8(ch.charCodeAt(0));
        for (let r = 0; r < 8; r++) for (let i = 0; i < 8; i++) if (glyph[r] & (0x80 >> i)) this.g.fillRect(x + i * scale, y + r * scale, scale, scale, c);
        x += 8 * scale;
      }
    }

    /** 带阴影的文本 */
    shadowText(str, x, y) {
      this.g.text(str, x + 1, y + 1, this.BLACK);
      this.g.text(str, x, y, this.WHITE);
    }

    /**
     * 绘制一帧（写入后台缓冲，不提交）。
     * @param {MarioGame} game
     */
    draw(game) {
      const g = this.g;
      if (game.state === 'intro' || game.state === 'gameover') {
        g.clear(this.BLACK);
        this.drawHUD(game);
        if (game.state === 'intro') {
          g.text(`WORLD ${game.levelDef.name}`, 88, 80, this.WHITE);
          g.blit(this.sprites.smallStand, 96, 104);
          g.text(`x  ${game.lives}`, 120, 108, this.WHITE);
        } else g.text('GAME OVER', 92, 112, this.WHITE);
        return;
      }
      this.drawWorld(game);
      this.drawHUD(game);
      if (game.state === 'title') this.drawTitle(game);
      if (game.autopilot && game.state !== 'clear') this.drawAutoBadge(game);
      if (game.state === 'play' && game.paused) {
        g.fillRect(100, 108, 56, 16, this.BLACK);
        g.text('PAUSE', 108, 112, this.WHITE);
      }
      if (game.state === 'clear') {
        this.shadowText('COURSE CLEAR!', 76, 72);
        this.shadowText(`SCORE ${String(game.score).padStart(6, '0')}`, 76, 88);
        if ((game.timer >> 4) % 2 === 0 || game.timer < 30) this.shadowText('PRESS ENTER TO PLAY AGAIN', 28, 112);
        this.shadowText('ESC TO RETURN TO DOS', 48, 128);
      }
    }

    /** 自动驾驶指示：HUD 下方的黑底徽标，左侧小灯闪烁 */
    drawAutoBadge(game) {
      const g = this.g, x = 176, y = 36;
      g.fillRect(x, y, 64, 11, this.BLACK);
      g.rect(x, y, 64, 11, this.index.Y);
      if ((game.frame >> 4) % 2 === 0) g.fillRect(x + 3, y + 4, 3, 3, this.index.R);
      g.text('AUTO', x + 10, y + 2, this.index.Y);
      g.text('P', x + 50, y + 2, this.index.z);
    }

    drawTitle(game) {
      const g = this.g;
      g.fillRect(36, 40, 184, 88, this.index.O);
      g.rect(36, 40, 184, 88, this.index.K);
      g.rect(38, 42, 180, 84, this.index.P);
      for (const [x, y] of [[41, 45], [212, 45], [41, 120], [212, 120]]) g.fillRect(x, y, 3, 3, this.index.K);
      this.bigText('MARIO', 48 + 2, 54 + 2, this.index.K, 4);
      this.bigText('MARIO', 48, 54, this.index.W, 4);
      g.text('WORLD 1-1 TRIBUTE', 60, 96, this.index.P);
      g.text('MARIO.COM  HTML-DOS', 52, 108, this.index.K);
      this.shadowText('PUSH ENTER TO START', 52, 146);
      this.shadowText(`TOP- ${String(Math.max(game.hiscore, game.score)).padStart(6, '0')}`, 76, 164);
    }

    drawHUD(game) {
      const g = this.g, W = this.WHITE;
      g.text('MARIO', 24, 16, W);
      g.text(String(game.score).padStart(6, '0'), 24, 24, W);
      const coinFrame = [0, 0, 0, 1, 2, 1][(game.frame >> 3) % 6];
      g.blit(this.sprites.hudCoin, 88, 24, coinFrame === 2 ? { remap: this.remaps.q2 } : {});
      g.text('x' + String(game.coins).padStart(2, '0'), 96, 24, W);
      g.text('WORLD', 144, 16, W);
      g.text(' ' + game.levelDef.name, 144, 24, W);
      g.text('TIME', 200, 16, W);
      if (game.state === 'play' || game.state === 'flag' || game.state === 'dying' || game.state === 'transform' || game.state === 'pipe' || game.state === 'clear') {
        g.text(String(game.time).padStart(3, '0'), 208, 24, W);
      }
    }

    drawWorld(game) {
      const g = this.g, area = game.area, cam = Math.floor(game.camX), S = this.sprites;
      const under = area.theme === 'underground';
      g.clear(under ? this.BLACK : this.index.S);
      if (!under) this.drawScenery(game, cam);
      // 从方块中升起的道具画在图块之前（看起来是从方块里冒出来）
      for (const it of game.items) if (it.rising > 0) this.drawItem(game, it, cam);
      const m = game.mario;
      if (m.behind && !m.hidden) this.drawMario(game, cam);
      // 图块
      const qFrame = [0, 0, 0, 1, 2, 1][(game.frame >> 3) % 6];
      const tileRemap = under ? this.remaps.under : null;
      const x0 = Math.floor(cam / TS), x1 = Math.min(area.w - 1, x0 + 17);
      for (let ty = 0; ty < 15; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = area.get(tx, ty);
          if (!t || t === T.HIDDEN) continue;
          let spr, remap = null;
          switch (t) {
            case T.GROUND: spr = S.ground; remap = under ? this.remaps.underGround : null; break;
            case T.BRICK: spr = S.brick; remap = tileRemap; break;
            case T.QUESTION: spr = S.question; remap = qFrame === 1 ? this.remaps.q1 : qFrame === 2 ? this.remaps.q2 : null; break;
            case T.USED: spr = S.used; break;
            case T.HARD: spr = S.hard; break;
            case T.PIPE_TL: spr = S.pipeTL; break;
            case T.PIPE_TR: spr = S.pipeTR; break;
            case T.PIPE_BL: spr = S.pipeBL; break;
            case T.PIPE_BR: spr = S.pipeBR; break;
            case T.POLE: spr = S.pole; break;
            case T.POLE_TOP: spr = S.poleTop; break;
            case T.CASTLE: spr = S.castle; break;
            case T.CASTLE_TOP: spr = S.castleTop; break;
            case T.CASTLE_ARCH: spr = S.castleArch; break;
            case T.CASTLE_DOOR: spr = S.castleDoor; break;
            case T.CASTLE_WINDOW: spr = S.castleWindow; break;
            case T.COIN: spr = [S.coin0, S.coin0, S.coin1, S.coin2, S.coin1][(game.frame >> 3) % 5]; break;
            case T.SPIPE_MT: spr = S.sidePipeMT; break;
            case T.SPIPE_MB: spr = S.sidePipeMB; break;
            case T.SPIPE_BT: spr = S.sidePipeBT; break;
            case T.SPIPE_BB: spr = S.sidePipeBB; break;
            default: continue;
          }
          let dy = 0;
          for (const b of game.bumps) if (b.tx === tx && b.ty === ty) dy = -Math.round(Math.sin(b.t / 12 * Math.PI) * 6);
          g.blit(spr, tx * TS - cam, ty * TS + dy, remap ? { remap } : undefined);
        }
      }
      // 旗子（挂在旗杆左侧）
      if (game.flag && area === game.areas.main) g.blit(S.flag, game.flag.x * TS - 8 - cam, game.flag.y);
      for (const it of game.items) if (!(it.rising > 0)) this.drawItem(game, it, cam);
      for (const e of game.enemies) this.drawEnemy(game, e, cam);
      if (!m.behind && !m.hidden) this.drawMario(game, cam);
      for (const f of game.effects) {
        if (f.kind === 'coinpop') g.blit([S.coin0, S.coin1, S.coin2, S.coin1][(f.t >> 2) % 4], f.x - cam, f.y);
        else if (f.kind === 'debris') g.blit(S.debris, f.x - cam, f.y, { flipX: (f.t >> 3) % 2 === 1, remap: under ? this.remaps.under : undefined });
        else if (f.kind === 'popup' || f.kind === 'flagscore') g.text(f.text, Math.round(f.x - cam), Math.round(f.y), this.WHITE);
      }
    }

    drawScenery(game, cam) {
      const sc = game.levelDef.scenery;
      if (!sc) return;
      const period = sc.period * TS;
      const S = this.sprites;
      for (const [kind, tx, layer, cloudRow] of sc.items) {
        const f = sc.parallax[layer] || 1;
        const off = cam * f;
        const base = tx * TS;
        // 覆盖可见范围的所有重复
        const kStart = Math.floor((off - base - 96) / period);
        for (let k = kStart; k <= kStart + 2; k++) {
          const x = Math.round(base + k * period - off);
          if (x > SCREEN_W || x < -96) continue;
          if (kind === 'hillBig') this.g.blit(S.hillBig, x, 13 * TS - S.hillBig.h);
          else if (kind === 'hillSmall') this.g.blit(S.hillSmall, x, 13 * TS - S.hillSmall.h);
          else {
            const n = +kind.slice(-1);
            const isBush = kind.startsWith('bush');
            const y = isBush ? 13 * TS - 22 : (cloudRow || 2) * TS;
            const opts = isBush ? { remap: this.remaps.bush } : undefined;
            this.g.blit(S.cloudL, x, y, opts);
            for (let i = 0; i < n; i++) this.g.blit(S.cloudM, x + 16 + i * 16, y, opts);
            this.g.blit(S.cloudR, x + 16 + n * 16, y, opts);
          }
        }
      }
    }

    drawItem(game, it, cam) {
      const S = this.sprites;
      const clipBottom = it.rising > 0 ? it.startY : undefined;
      if (it.kind === 'mushroom') this.g.blit(S.mushroom, it.x - cam, it.y, { clipBottom });
      else if (it.kind === 'oneup') this.g.blit(S.mushroom, it.x - cam, it.y, { clipBottom, remap: this.remaps.oneup });
      else if (it.kind === 'star') {
        const r = [null, this.remaps.q1, this.remaps.q2, this.remaps.q1][(game.frame >> 2) % 4];
        this.g.blit(S.star, it.x - cam, it.y, { clipBottom, remap: r || undefined });
      }
    }

    drawEnemy(game, e, cam) {
      const S = this.sprites, x = Math.round(e.x - cam), y = Math.round(e.y);
      const dead = e.state === 'dead';
      if (e.kind === 'goomba') {
        if (e.state === 'flat') this.g.blit(S.goombaFlat, x, y);
        else this.g.blit(S.goomba, x, y, { flipX: !dead && (game.frame >> 3) % 2 === 1, flipY: dead });
      } else {
        if (e.state === 'walk') {
          const spr = (game.frame >> 3) % 2 ? S.koopa2 : S.koopa;
          this.g.blit(spr, x, y - 8, { flipX: e.vx > 0 });
        } else if (e.state === 'shell' && e.timer > 300) this.g.blit((game.frame >> 2) % 2 ? S.shellFeet : S.shell, x, y);
        else this.g.blit(S.shell, x, y, { flipY: dead });
      }
    }

    /** 选择马里奥当前帧 */
    marioSprite(game) {
      const m = game.mario, S = this.sprites;
      if (m.dead) return { spr: S.smallDead, big: false };
      let big = m.big;
      if (game.state === 'transform' && game.transform) {
        const phase = (game.transform.t >> 2) % 2 === 0;
        big = game.transform.kind === 'grow' ? phase : !phase;
      }
      const P = big ? 'big' : 'small';
      if (m.crouch && big) return { spr: S.bigCrouch, big, crouch: true };
      const f = game.flag;
      if (game.state === 'flag' && f && (f.stage === 'slide' || f.stage === 'turn')) return { spr: S[P + 'Climb'], big };
      if (game.state === 'pipe') return { spr: S[P + 'Stand'], big };
      if (!m.onGround && game.state !== 'flag') return { spr: S[P + 'Jump'], big };
      if (m.skid) return { spr: S[P + 'Skid'], big };
      if (Math.abs(m.vx) > 0.01) return { spr: S[P + ['Walk1', 'Walk2', 'Walk3'][Math.floor(m.anim) % 3]], big };
      return { spr: S[P + 'Stand'], big };
    }

    drawMario(game, cam) {
      const m = game.mario;
      if (m.invuln > 0 && (game.frame >> 1) % 2 === 0) return;
      const { spr, big, crouch } = this.marioSprite(game);
      const bottom = m.y + m.h;
      const y = Math.round(bottom - (big ? (crouch ? 30 : 31) : 16));
      const x = Math.round(m.x - 2 - cam);
      let remap;
      if (m.star > 0) remap = [this.remaps.star1, this.remaps.star2, this.remaps.star3, null][(game.frame >> 2) % 4] || undefined;
      let clipBottom;
      if (m.behind && game.pipe) {
        if (game.pipe.dir === 'down') clipBottom = this._pipeTopPx(game);
        if (game.pipe.dir === 'up') clipBottom = game.pipe.top * TS;
      }
      this.g.blit(spr, x, y, { flipX: m.facing < 0, remap, clipBottom });
    }

    _pipeTopPx(game) {
      const w = game.pipe.warp;
      for (let y = 0; y < 15; y++) if (game.area.get(w.x, y) === T.PIPE_TL) return y * TS;
      return 240;
    }
  }

  // ==================================================================
  // 宿主程序：固定时间步长循环 + 键盘映射 + 音频
  // ==================================================================

  const HISCORE_KEY = 'htmldos.mario.hiscore';

  const MarioProgram = {
    /** 键盘映射（KeyboardEvent.code） */
    KEYS: {
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      up: ['ArrowUp', 'KeyW'],
      down: ['ArrowDown', 'KeyS'],
      a: ['KeyZ', 'Space'],
      b: ['KeyX', 'ShiftLeft', 'ShiftRight'],
      start: ['Enter', 'NumpadEnter']
    },
    /** 自动驾驶开关键 */
    AUTO_KEY: 'KeyP',

    loadHiscore(m) {
      try { return +((m.storage && m.storage.getItem(HISCORE_KEY)) || 0) || 0; } catch (e) { return 0; }
    },

    saveHiscore(m, v) {
      try { if (m.storage && v > this.loadHiscore(m)) m.storage.setItem(HISCORE_KEY, String(v)); } catch (e) { /* 忽略 */ }
    },

    /**
     * 运行游戏直到 Esc / Ctrl+C。
     * @param {object} m Machine
     * @param {{switches?:object}} args
     */
    async run(m, args = {}) {
      const sw = args.switches || {};
      const musicOn = sw.M === undefined;
      const Audio = m.audio;
      m.enterGraphics(SCREEN_W, SCREEN_H);
      const renderer = new MarioRenderer(m.gfx);
      renderer.setupPalette();
      const game = new MarioGame({ hiscore: this.loadHiscore(m) });
      const pilot = new DOS.MarioAutoPilot();
      this.current = game; // 调试句柄（浏览器控制台：DOS.MarioProgram.current）
      this.pilot = pilot;
      game.autopilot = sw.A !== undefined;
      const toggleAuto = () => {
        game.autopilot = !game.autopilot;
        pilot.reset();
        Audio.sfx(game.autopilot ? 'oneup' : 'bump');
        m.announce(game.autopilot ? 'Autopilot on.' : 'Autopilot off.');
      };
      this.toggleAuto = toggleAuto; // 供页面 HUD 上的开关调用
      m.announce('MARIO started. Press Enter to start, Escape to quit.');
      const STEP = 1000 / 60;
      let acc = 0;
      let last = (typeof performance !== 'undefined' ? performance : Date).now();
      const tapped = new Set();
      const down = (k) => this.KEYS[k].some(c => m.input.isDown(c) || tapped.has(c));
      let quit = false;
      const handleEvents = () => {
        for (const ev of game.events) {
          if (ev.type === 'sfx') Audio.sfx(ev.name);
          else if (ev.type === 'music') {
            if (ev.name === 'start') { if (musicOn) Audio.playMusic(game.data.MUSIC); }
            else if (ev.name === 'stop') Audio.stopMusic();
            else if (ev.name === 'pause') Audio.pauseMusic(true);
            else if (ev.name === 'resume') Audio.pauseMusic(false);
            else if (ev.name === 'speed') Audio.setMusicSpeed(ev.speed);
          } else if (ev.type === 'announce') m.announce(ev.name);
          else if (ev.type === 'hiscore') this.saveHiscore(m, ev.value);
        }
        game.events.length = 0;
      };
      try {
        while (!quit) {
          await m.gfx.waitVBlank();
          const now = (typeof performance !== 'undefined' ? performance : Date).now();
          acc += Math.min(250, now - last);
          last = now;
          let ev;
          while ((ev = m.input.pollKey())) {
            if (ev.key === 'Escape' || ev.key === 'Break') quit = true;
            else if (ev.code === this.AUTO_KEY) toggleAuto();
            if (ev.code) tapped.add(ev.code);
          }
          if (m.breakFlag) quit = true;
          const input = {};
          for (const k of Object.keys(this.KEYS)) input[k] = down(k);
          let steps = 0;
          while (acc >= STEP && steps < 5) {
            // 自动驾驶接管方向/跳/跑；Enter（暂停）仍由玩家控制
            let frameInput = input;
            if (game.autopilot) {
              frameInput = pilot.next(game);
              if (input.start) frameInput.start = true;
            }
            game.step(frameInput);
            acc -= STEP;
            steps++;
            handleEvents();
            tapped.clear();
            for (const k of Object.keys(this.KEYS)) input[k] = this.KEYS[k].some(c => m.input.isDown(c));
          }
          if (acc > STEP * 5) acc = 0;
          renderer.draw(game);
          m.gfx.swap();
        }
      } finally {
        this.current = null;
        this.pilot = null;
        this.toggleAuto = null;
        Audio.stopMusic();
        game.hiscore = Math.max(game.hiscore, game.score);
        this.saveHiscore(m, game.hiscore);
      }
      return 0;
    }
  };

  DOS.MarioGame = MarioGame;
  DOS.MarioRenderer = MarioRenderer;
  DOS.MarioProgram = MarioProgram;
  DOS.MarioTiles = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
