/*
 * MarioAI —— MARIO.COM 的自动驾驶：人格化效用规划
 * ---------------------------------------------------------------
 * 两层结构：
 *
 * 1. 策略层（Strategist）——参考 Holmgård、Liapis、Togelius、Yannakakis 的
 *    “程序化人格”（Procedural Personas）：不同人格只是对各种可得收益的权重不同。
 *    每次需要新子目标时，列出当前可达的机会（问号块、隐藏方块、道具、敌人、龟壳、
 *    金币、隐藏水管），用 人格权重 × 价值 − 路程代价 打分，挑最高的；都不值得就去旗杆。
 *
 * 2. 执行层（A* 前向模型规划）——参考 2009 年 Mario AI Competition 冠军
 *    Robin Baumgarten 的 A*：克隆 MarioGame，用游戏自己的物理推进；
 *    动作集为 {左/右/不动} × {跳} × {跑}（去水管时加“下”），每个节点重复 2 帧；
 *    f = 已用帧数 × 0.9 + 到子目标的估计帧数（考虑当前速度与需要爬升的高度）+ 惩罚；
 *    死亡分支剪掉，受伤重罚；相同状态只展开一次；计划保留并从末尾的预测状态继续延伸。
 *    活路检查：达成子目标、或只采纳部分计划时，终点之后必须被证实还能活一段时间，
 *    否则宁可重规划 / 加深搜索 / 放弃该子目标——收集再多也不能把命丢掉。
 *
 * 像人一样玩（Mario AI Championship 2012 图灵测试赛道指出：机器人的破绽是
 * 永远全速奔跑、总在最后一个像素起跳）：人格可开启“拟人”——
 * 跑步有少量额外代价（不必要时走路）、贴着坑边最后一刻起跳会被惩罚、
 * 完成子目标后偶尔停顿片刻（先用前向模型确认停顿是安全的）。
 *
 * 规划路线（逐帧位置）与当前子目标会暴露给渲染层，按 V 显示叠加层。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const REPEAT = 2;            // 每个搜索节点重复同一动作的帧数
  const HORIZON = 176;         // 以旗杆为目标时的规划视野（像素）
  const GROUND_Y = 13 * 16;    // 地面顶端
  const DAMAGE_PENALTY = 5000;
  const CLIMB_SPEED = 2.5;     // 估算爬升代价的平均上升速度（像素/帧）
  const MAX_TARGET_FRAMES = 900; // 同一子目标最多尝试的帧数，超过就放弃（加入黑名单）
  const SAFE_TAIL = 16;        // 部分计划的终点之后至少要有这么多帧被搜索证实能活下去
  const PARTIAL_MAX = 32;
  const MIN_PARTIAL = 4;
  const DEEPEN = 3;            // 搜不到时加深一次的预算倍数
  const EXTEND_BUDGET = 2.5;   // 一次计划延伸（可能含多次搜索）的总时间上限 = 单次预算 × 这个倍数      // 没搜到子目标时只采纳部分计划的前这么多帧（滚动时域），避免带着惯性冲过头

  /** 基本动作集（与 MarioGame.step 的输入格式一致） */
  const ACTIONS = [
    { right: true, b: true }, { right: true, b: true, a: true },
    { right: true }, { right: true, a: true },
    { left: true, b: true }, { left: true, b: true, a: true },
    { left: true }, { left: true, a: true },
    { a: true }, {}
  ];
  const DOWN = { down: true };
  /** 生存检查用的几种后续操作：[前 6 帧, 之后] */
  const ESCAPES = [
    [{}, {}], [{ left: true }, { left: true }], [{ right: true }, { right: true }],
    [{ right: true, a: true }, { right: true, a: true }], [{ left: true, a: true }, { left: true, a: true }],
    [{ a: true }, { a: true }], [{ left: true, b: true, a: true }, { left: true, b: true }], [{ right: true, b: true, a: true }, { right: true, b: true }]
  ];

  /**
   * 人格：各类收益的价值（单位：帧——为它愿意多花多少帧）。
   * human = 拟人行为；runCost = 按住 B 的额外代价/帧；safety = 受伤惩罚倍数；flagTop = 追求高处抓旗杆。
   */
  const PERSONAS = {
    allround: { name: 'ALL-ROUND', zh: '全能', desc: 'Plays like a person: grabs blocks, power-ups and the hidden 1UP, stomps what is in the way, walks when there is no hurry', coin: 110, block: 80, item: 420, oneup: 700, star: 260, stomp: 90, kick: 140, secret: 300, coinTile: 50, human: true, runCost: 0.2, safety: 1, flagTop: 0.5 },
    speedrun: { name: 'SPEEDRUN', zh: '速通', desc: 'Ignores everything and races to the flag', coin: 0, block: 0, item: 0, oneup: 0, star: 0, stomp: 0, kick: 0, secret: 0, coinTile: 0, human: false, runCost: 0, safety: 1, flagTop: 1 },
    collector: { name: 'COLLECTOR', zh: '收集者', desc: 'Coins first: every ? block, coin bricks and the bonus room', coin: 260, block: 160, item: 520, oneup: 700, star: 220, stomp: 0, kick: 0, secret: 600, coinTile: 150, human: true, runCost: 0.2, safety: 1.5, flagTop: 0.5 },
    hunter: { name: 'HUNTER', zh: '猎手', desc: 'Goes after enemies: stomps goombas, kicks shells, wants the star', coin: 30, block: 30, item: 300, oneup: 300, star: 900, stomp: 600, kick: 700, secret: 0, coinTile: 20, human: true, runCost: 0.1, safety: 1, flagTop: 0.3 },
    explorer: { name: 'EXPLORER', zh: '探索者', desc: 'Looks for secrets: the warp pipe to the bonus room and hidden blocks', coin: 80, block: 150, item: 360, oneup: 700, star: 300, stomp: 40, kick: 60, secret: 1000, coinTile: 90, human: true, runCost: 0.2, safety: 1.5, flagTop: 0.3 },
    cautious: { name: 'CAUTIOUS', zh: '稳健', desc: 'Plays it safe: never hunts enemies or secrets, walks instead of running, guards its power-up', coin: 50, block: 50, item: 520, oneup: 400, star: 260, stomp: 0, kick: 0, secret: 0, coinTile: 40, human: true, runCost: 0.6, safety: 4, flagTop: 0 }
  };
  const PERSONA_ORDER = ['allround', 'speedrun', 'collector', 'hunter', 'explorer', 'cautious'];

  /** 最小二叉堆（按 f） */
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    peek() { return this.a[0]; }
    push(n) {
      const a = this.a;
      a.push(n);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].f < a[m].f) m = l;
          if (r < a.length && a[r].f < a[m].f) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    }
  }

  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

  /** 可复现的伪随机数（mulberry32） */
  function rng32(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class MarioAutoPilot {
    /**
     * @param {object} [opts]
     * @param {string} [opts.persona='allround'] 人格（见 PERSONAS）
     * @param {number} [opts.budgetMs=6]  每次搜索的时间预算（浏览器中避免卡帧；测试中设为 Infinity 以保证确定性）
     * @param {number} [opts.maxNodes=300] 每次搜索最多模拟的节点数
     * @param {number} [opts.minPlan=12]   剩余计划少于这么多帧时向前延伸规划
     * @param {number} [opts.seed=1]       拟人行为的随机种子
     */
    constructor(opts = {}) {
      this.budgetMs = opts.budgetMs === undefined ? 6 : opts.budgetMs;
      this.maxNodes = opts.maxNodes || 300;
      this.minPlan = opts.minPlan || 12;
      this.repeat = REPEAT;
      this.weight = 0.9;
      this.rand = rng32(opts.seed || 1);
      this.plan = [];
      this.path = [];
      this.target = null;
      this.blacklist = new Set();
      this.deadline = Infinity;
      this.targetFrames = 0;
      this.stats = { searches: 0, nodes: 0, lastNodes: 0, lastMs: 0, reachedHorizon: 0, replans: 0, goals: 0, idles: 0 };
      this.setPersona(opts.persona || 'allround');
    }

    /** 切换人格（清空计划） */
    setPersona(id) {
      this.personaId = PERSONAS[id] ? id : 'allround';
      this.persona = PERSONAS[this.personaId];
      this.blacklist.clear();
      this.reset();
    }

    /** 轮换到下一个人格，返回新的人格 ID */
    cyclePersona() {
      const i = PERSONA_ORDER.indexOf(this.personaId);
      this.setPersona(PERSONA_ORDER[(i + 1) % PERSONA_ORDER.length]);
      return this.personaId;
    }

    /** 清空已有计划（开关自动驾驶、切换人格、关卡重开时） */
    reset() {
      this.plan = [];
      this.path = [];
      this.target = null;
      this.targetFrames = 0;
    }

    /**
     * 计算本帧应给出的输入。
     * @param {object} game MarioGame
     * @returns {object} 输入 {left,right,up,down,a,b,start}
     */
    next(game) {
      if (game.state === 'title') { this.blacklist.clear(); return { start: game.frame % 2 === 0 }; }
      if (game.state !== 'play' || game.paused) {
        if (game.state === 'dying' || game.state === 'intro') this.blacklist.clear();
        this.reset();
        return {};
      }
      if (this.plan.length < this.minPlan) this._extend(game);
      this.path.shift();
      this.targetFrames++;
      return Object.assign({}, this.plan.shift() || { right: true, b: true });
    }

    // ==================================================================
    // 策略层：选择子目标
    // ==================================================================

    /** 目标的唯一键（黑名单用） */
    _key(t) { return t.type + ':' + (t.id !== undefined ? t.id : t.tx + ',' + t.ty) + ':' + t.area; }

    /**
     * 列出当前状态下可追求的机会并打分。
     * @returns {object[]} 目标（含 score），按分数从高到低
     */
    _candidates(g) {
      const P = this.persona, a = g.area, m = g.mario, T = DOS.MarioTiles;
      const minX = g.camX + 8, maxX = g.camX + 256 + 112;
      const mx = m.x + m.w / 2, my = m.y;
      const out = [];
      const add = (t, value) => {
        if (value <= 0 || t.x < minX || t.x > maxX) return;
        t.area = a.id;
        if (this.blacklist.has(this._key(t))) return;
        const travel = Math.abs(t.x - mx) / 2 + Math.max(0, my - t.y) / 2;
        t.score = value - travel;
        if (t.score > 0) out.push(t);
      };
      // 方块：问号块、（已知的）隐藏方块、有内容的砖块；地下的金币
      const x0 = Math.max(0, Math.floor(minX / 16)), x1 = Math.min(a.w - 1, Math.floor(maxX / 16));
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = 0; ty < 15; ty++) {
          const tile = a.get(tx, ty);
          if (tile === T.COIN) { add({ type: 'coin', tx, ty, x: tx * 16 + 8, y: ty * 16, label: 'COIN' }, P.coinTile); continue; }
          const content = a.contents.get(tx + ',' + ty);
          if (tile !== T.QUESTION && tile !== T.HIDDEN && !(tile === T.BRICK && content)) continue;
          const c = content || 'coin';
          let value = P.block;
          if (c === 'coin' || c === 'coins') value += P.coin;
          else if (c === 'mushroom') value += m.big ? P.coin : P.item;
          else if (c === '1up') value += P.oneup;
          else if (c === 'star') value += P.star;
          if (tile === T.HIDDEN) value += P.secret;
          const label = tile === T.HIDDEN ? 'SECRET BLOCK' : c === 'coins' ? 'COIN BRICK' : c === 'coin' ? '? COIN' : c === 'star' ? 'STAR BRICK' : '? ' + c.toUpperCase();
          add({ type: 'block', tx, ty, x: tx * 16 + 8, y: (ty + 1) * 16, label }, value);
        }
      }
      // 道具
      for (const it of g.items) {
        const value = it.kind === 'oneup' ? P.oneup : it.kind === 'star' ? P.star : (m.big ? P.coin : P.item);
        add({ type: 'item', id: it.id, x: it.x + 8, y: it.y, label: it.kind === 'oneup' ? '1UP' : it.kind.toUpperCase() }, value);
      }
      // 敌人：踩踏；静止的龟壳：踢
      for (const e of g.enemies) {
        if (e.state === 'walk' && e.y + e.h <= GROUND_Y + 1) add({ type: 'stomp', id: e.id, x: e.x + 8, y: e.y, label: 'STOMP ' + e.kind.toUpperCase() }, P.stomp);
        else if (e.state === 'shell') add({ type: 'kick', id: e.id, x: e.x + 8, y: e.y, label: 'KICK SHELL' }, P.kick);
      }
      // 隐藏水管（进入地下奖励房）
      if (P.secret > 0 && a.def.warps && g.areas.bonus && !g.areas.bonus.visited) {
        for (const w of a.def.warps) {
          const top = g._pipeTop(w.x);
          add({ type: 'pipe', tx: w.x, ty: top, x: w.x * 16 + 16, y: top * 16, label: 'SECRET PIPE' }, P.secret + 10 * P.coinTile);
        }
      }
      return out.sort((p, q) => q.score - p.score);
    }

    /** 终点目标：主关卡为旗杆，地下奖励房为侧向出口水管 */
    _finalTarget(g) {
      const def = g.area.def;
      if (def.sidePipe) return { type: 'exit', x: def.sidePipe.x * 16, y: (def.sidePipe.y + 1) * 16, tx: def.sidePipe.x, ty: def.sidePipe.y, label: 'EXIT PIPE', area: g.area.id };
      if (def.flag) return { type: 'flag', x: def.flag.x * 16 + 8, y: def.flag.top * 16, tx: def.flag.x, ty: def.flag.top, label: 'FLAG', area: g.area.id };
      return { type: 'flag', x: g.area.w * 16, y: GROUND_Y, label: 'GOAL', area: g.area.id };
    }

    /** 目标在给定状态中是否仍然有效 */
    _valid(g, t) {
      if (!t || t.area !== g.area.id) return false;
      if (t.type === 'flag' || t.type === 'exit') return true;
      if (t.x < g.camX + 4) return false;
      if (this.blacklist.has(this._key(t))) return false;
      const T = DOS.MarioTiles;
      switch (t.type) {
        case 'block': { const tile = g.area.get(t.tx, t.ty); return tile === T.QUESTION || tile === T.HIDDEN || tile === T.BRICK; }
        case 'coin': return g.area.get(t.tx, t.ty) === T.COIN;
        case 'item': return g.items.some(i => i.id === t.id);
        case 'stomp': return g.enemies.some(e => e.id === t.id && e.state === 'walk');
        case 'kick': return g.enemies.some(e => e.id === t.id && e.state === 'shell');
        case 'pipe': return !(g.areas.bonus && g.areas.bonus.visited);
      }
      return false;
    }

    /** 选择子目标（带滞后：新目标要明显更好才切换） */
    _chooseTarget(g) {
      const list = this._candidates(g);
      const cur = this._valid(g, this.target) && this.target.type !== 'flag' && this.target.type !== 'exit' ? this.target : null;
      if (cur) {
        const again = list.find(c => this._key(c) === this._key(cur));
        const best = list[0];
        if (again && (!best || best.score < again.score + 60)) return again;
      }
      return list[0] || this._finalTarget(g);
    }

    // ==================================================================
    // 执行层：A* 前向模型搜索
    // ==================================================================

    /** 方块状态快照（图块 + 多金币计数），用于判断是否顶到了目标方块 */
    _blockSig(g, t) {
      const st = g.area.multi.get(t.tx + ',' + t.ty);
      return g.area.get(t.tx, t.ty) + ':' + (st ? st.count : 0);
    }

    /** 子目标是否在该状态中达成 */
    _reached(t, g, rootSig, rootStats) {
      switch (t.type) {
        case 'flag': return g.state === 'flag';
        case 'exit': return (g.state === 'pipe' && g.pipe && g.pipe.dir === 'right') || g.area.id !== t.area;
        case 'pipe': return (g.state === 'pipe' && g.pipe && g.pipe.dir === 'down') || g.area.id !== t.area;
        case 'block': return g.area.id === t.area && this._blockSig(g, t) !== rootSig;
        case 'coin': return g.area.id === t.area && g.area.get(t.tx, t.ty) !== DOS.MarioTiles.COIN;
        case 'item': return g.stats.items > rootStats.items;
        case 'stomp': return g.stats.stomps + g.stats.kills > rootStats.stomps + rootStats.kills && !g.enemies.some(e => e.id === t.id && e.state === 'walk');
        case 'kick': return g.stats.kicks > rootStats.kicks;
      }
      return false;
    }

    /** 目标在该状态下的当前坐标（移动的道具/敌人按 id 查找） */
    _targetPos(g, t) {
      if (t.type === 'item') { const it = g.items.find(i => i.id === t.id); return it ? { x: it.x + 8, y: it.y } : t; }
      if (t.type === 'stomp' || t.type === 'kick') { const e = g.enemies.find(i => i.id === t.id); return e ? { x: e.x + 8, y: e.y } : t; }
      return t;
    }

    /**
     * 从当前水平速度出发、以奔跑加速度加速到最高速，走完 dist 像素所需的帧数。
     * 与 Baumgarten 的 maxForwardMovement 同理：只用“最高速度”估计会让刚落地/起步的
     * 状态显得代价过高，A* 退化为广度优先。
     */
    _timeToCover(dist, v, P) {
      if (dist <= 0) return 0;
      const a = P.runAccel, vmax = P.maxRun;
      let extra = 0;
      if (v < 0) { extra = -v / P.skidDecel; v = 0; } // 先刹掉反方向的速度
      v = Math.max(v, P.minWalk);
      const ta = (vmax - v) / a;
      const da = v * ta + 0.5 * a * ta * ta;
      if (dist <= da) return extra + (-v + Math.sqrt(v * v + 2 * a * dist)) / a;
      return extra + ta + (dist - da) / vmax;
    }

    /**
     * 前方墙体还需爬升的高度（像素）：检查马里奥前方 3 列，从脚下那一行向上数连续的实心图块。
     * 这样起跳上升本身就被视为进展，不会在高水管前大量展开“原地不动”的节点。
     */
    _climb(g) {
      const m = g.mario;
      const bottom = m.y + m.h;
      const feetRow = Math.floor((bottom - 1) / 16);
      const front = Math.floor((m.x + m.w) / 16);
      let need = 0;
      for (let cx = front; cx <= front + 2; cx++) {
        let row = feetRow;
        if (!g._solid(cx, row)) continue;
        while (row > 0 && g._solid(cx, row - 1)) row--;
        need = Math.max(need, bottom - row * 16);
      }
      return need;
    }

    /** 马里奥正下方第一块实心图块上站立时的 y（脚下是坑则取当前 y） */
    _standY(g) {
      const m = g.mario;
      if (m.onGround) return m.y;
      const cx = Math.floor((m.x + m.w / 2) / 16);
      for (let row = Math.max(0, Math.floor((m.y + m.h) / 16)); row < 15; row++) {
        if (g._solid(cx, row)) return row * 16 - m.h;
      }
      return m.y;
    }

    /** 到子目标的估计帧数 */
    _heuristic(g, t) {
      const m = g.mario, P = g.P;
      if (g.area.id !== t.area) return 0;
      if (t.type === 'flag' || t.type === 'exit') {
        const reach = t.type === 'flag' ? m.x + m.w : m.x + m.w;
        return this._timeToCover(Math.max(0, t.x - reach), m.vx, P) + this._climb(g) / CLIMB_SPEED;
      }
      const pos = this._targetPos(g, t);
      const dx = pos.x - (m.x + m.w / 2);
      const dir = Math.sign(dx) || 1;
      const far = Math.abs(dx) > 20;
      let h = this._timeToCover(Math.max(0, Math.abs(dx) - 4), m.vx * dir, P);
      if (dx > 24) h += this._climb(g) / CLIMB_SPEED;
      // 离目标还远时，垂直距离按“落地后”的高度算：否则在半路随便跳一下就显得更近，
      // A* 会在原地展开大量无用的跳跃（启发式平台）
      const y = far ? this._standY(g) : m.y;
      if (t.type === 'block') h += Math.max(0, y - pos.y) / CLIMB_SPEED;            // 头要碰到方块底
      else if (t.type === 'pipe') h += Math.max(0, y + m.h - pos.y) / CLIMB_SPEED;  // 脚要站上管口
      else if (t.type === 'item' || t.type === 'coin') h += Math.abs(y + m.h / 2 - pos.y - 8) / 4;
      return h;
    }

    /** 评估模拟后的节点：设置 dead / goal / f */
    _evaluate(node, ctx) {
      const g = node.state, m = g.mario;
      if (this._reached(ctx.target, g, ctx.rootSig, ctx.rootStats)) {
        node.goal = true;
        let bonus = 0;
        if (ctx.target.type === 'flag') bonus = Math.max(0, (12 * 16 - (m.y + m.h)) / 4) * this.persona.flagTop; // 抓得越高越好
        node.f = node.t * this.weight + node.extra - bonus;
        return;
      }
      const falling = !m.onGround && m.y + m.h > GROUND_Y + 2 && g.state === 'play';
      if (g.state === 'dying' || g.state === 'gameover' || falling || (g.state !== 'play' && g.state !== 'transform')) {
        node.dead = true; node.f = Infinity; return;
      }
      const damaged = (ctx.startBig && !m.big) || (g.state === 'transform' && g.transform && g.transform.kind === 'shrink');
      // 启发式按“跑步”估计帧数；人格给跑步加了额外代价，启发式也要同比放大，否则走/跑两类分支会被同等展开
      node.f = node.t * this.weight + node.extra + this._heuristic(g, ctx.target) * (1 + this.persona.runCost) + (damaged ? DAMAGE_PENALTY * this.persona.safety : 0);
    }

    /** 粗略的生存检查：几种简单的后续操作中至少有一种能安全撑过 SAFE_TAIL 帧 */
    _survives(state, ctx) {
      const big = state.mario.big || state.state === 'transform';
      for (const seq of ESCAPES) {
        const s = state.clone();
        let ok = true;
        for (let i = 0; i < SAFE_TAIL && ok; i++) {
          s.step(seq[i < 6 ? 0 : 1]);
          const m = s.mario;
          if (s.state === 'flag' || s.state === 'pipe' || s.state === 'clear') break;
          if (s.state === 'dying' || s.state === 'gameover' || (!m.onGround && m.y + m.h > GROUND_Y + 2)) ok = false;
          else if (big && !m.big && s.state !== 'transform') ok = false;
          else if (s.state === 'transform' && s.transform && s.transform.kind === 'shrink') ok = false;
        }
        if (ok) return true;
      }
      return false;
    }

    /** 拟人代价：按住 B 跑步的额外代价、贴着坑边最后一刻起跳的惩罚 */
    _humanCost(parent, node) {
      const P = this.persona;
      let c = 0;
      if (node.action.b) c += P.runCost * this.repeat;
      if (P.human) {
        const pm = parent.state.mario, m = node.state.mario;
        if (pm.onGround && !m.onGround && m.vy < 0) {
          // 起跳点前方 6 像素已经没有地面 = 在坑边最后一刻才跳
          const ahead = Math.floor((pm.x + (node.action.left ? -6 : pm.w + 6)) / 16);
          const feet = Math.floor((pm.y + pm.h + 1) / 16);
          if (!parent.state._solid(ahead, feet)) c += 12;
        }
      }
      return c;
    }

    /**
     * A* 搜索：返回逐帧输入序列。
     * @param {object} game 起点状态（不会被修改）
     * @param {object} [target] 子目标；省略时为旗杆/出口
     * @returns {{plan:object[], ok:boolean, goal:boolean}} ok 表示到达了子目标（或旗杆模式下到达视野）
     */
    search(game, target, scale = 1) {
      const t0 = now();
      target = target || this._finalTarget(game);
      const actions = target.type === 'pipe' ? ACTIONS.concat([DOWN]) : ACTIONS;
      const ctx = {
        target,
        startBig: game.mario.big,
        rootSig: target.type === 'block' ? this._blockSig(game, target) : null,
        rootStats: Object.assign({}, game.stats)
      };
      const root = { state: game.clone(), parent: null, action: null, t: 0, extra: 0, f: 0, deep: 0 };
      this._evaluate(root, ctx);
      const dist = (g) => { const p = this._targetPos(g, target); return Math.abs(p.x - (g.mario.x + g.mario.w / 2)); };
      const d0 = dist(root.state);
      const progress = (g) => g.area.id === target.area ? d0 - dist(g) : 0;
      const open = new Heap();
      const visited = new Set();
      const ground = [];
      let best = null, bestH = null, bestHGround = null, sims = 0;

      const expand = (node) => {
        const m = node.state.mario, prevA = !!node.state.prev.a;
        // 地面：A 仍按着时无法再次起跳；空中：只有上升且按住 A 时 A 才有意义
        const canJump = m.onGround ? !prevA : (m.holdJump && m.vy < 0);
        for (const action of actions) {
          if (action.a && !canJump) continue;
          if (!m.onGround && (action.b || action.down)) continue; // 空中 B/下 不影响结果，属于重复分支
          open.push({ state: null, parent: node, action, t: node.t + this.repeat, extra: node.extra, f: node.f, deep: 0 });
        }
      };
      expand(root);

      const maxNodes = this.maxNodes * scale, budgetMs = Math.min(this.budgetMs * scale, Math.max(1, this.deadline - t0));
      while (open.size && sims < maxNodes && now() - t0 < budgetMs) {
        const node = open.pop();
        if (!node.state) {
          // 惰性求值：出队时才用前向模型模拟
          node.state = node.parent.state.clone();
          for (let i = 0; i < this.repeat; i++) node.state.step(node.action);
          sims++;
          node.extra += this._humanCost(node.parent, node);
          this._evaluate(node, ctx);
          if (node.dead) continue;
          // deep = 子树中活着的最深节点的时间：用来证明某个节点之后还有活路
          node.deep = node.t;
          for (let p = node.parent; p && p.deep < node.t; p = p.parent) p.deep = node.t;
          if (open.size && node.f > open.peek().f + 0.1) { open.push(node); continue; }
        }
        if (node.goal) {
          // 达成子目标后还得活得下去（比如踩完敌人别落进另一群敌人中间）
          if (target.type === 'flag' || target.type === 'exit' || target.type === 'pipe' || this._survives(node.state, ctx)) { best = node; break; }
          continue;
        }
        const g = node.state, m = g.mario;
        // 状态键必须包含“A 是否仍按着/是否还能延长跳跃”，否则按住 A 的站立状态会把可起跳的同位置状态剪掉
        const key = `${Math.round(m.x / 2)},${Math.round(m.y / 2)},${Math.round(m.vx * 4)},${Math.round(m.vy)},${g.prev.a ? 1 : 0}${m.holdJump ? 1 : 0},${g.area.id}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const h = node.f - node.t * this.weight - node.extra;
        if (!bestH || h < bestH.h) bestH = { node, h };
        if (m.onGround && g.state === 'play') {
          node.h = h;
          ground.push(node);
          if (!bestHGround || h < bestHGround.h) bestHGround = { node, h };
        }
        // 远处的目标：朝它推进了 HORIZON 像素、站在地面上、之后还能活，就先执行这一段（滚动时域）
        if (m.onGround && progress(g) >= HORIZON && this._survives(g, ctx)) { best = node; this.stats.reachedHorizon++; break; }
        expand(node);
      }

      this.stats.searches++;
      this.stats.nodes += sims;
      this.stats.lastNodes = sims;
      this.stats.lastMs = now() - t0;
      // 未达成时选“离目标最近、站在地面上、而且之后被证实还能活 SAFE_TAIL 帧”的节点，
      // 避免把计划停在坑的半空中或一群敌人中间；没有这样的节点再退而求其次
      // （子树已证实能活够久的直接可用，否则用几种简单的后续操作快速检查；最多检查 6 个）
      let safe = null;
      if (!best) {
        ground.sort((p, q) => p.h - q.h);
        for (let i = 0, checks = 0; i < ground.length && checks < 6; i++) {
          const n = ground[i];
          if (n.deep - n.t >= SAFE_TAIL) { safe = n; break; }
          checks++;
          if (this._survives(n.state, ctx)) { safe = n; break; }
        }
      }
      const pick = best || safe || (bestHGround && bestHGround.node) || (bestH && bestH.node);
      if (!pick) return { plan: [{ right: true, b: true }], ok: false, goal: false, safe: false };
      const plan = [];
      for (let n = pick; n.parent; n = n.parent) for (let i = 0; i < this.repeat; i++) plan.unshift(n.action);
      // safe：终点之后被证实还有活路（达成目标的节点也做过生存检查）
      return { plan, ok: !!best, goal: !!(best && best.goal), safe: pick === best || pick === safe };
    }

    // ==================================================================
    // 计划延伸
    // ==================================================================

    /** 在 state 的副本上模拟一段输入，返回逐帧位置（叠加层用）与结束状态 */
    _simulate(state, inputs) {
      const s = state.clone();
      const pts = [];
      for (const a of inputs) { s.step(a); pts.push({ x: s.mario.x + s.mario.w / 2, y: s.mario.y + s.mario.h / 2, area: s.area.id }); }
      return { end: s, pts };
    }

    /** 把一段计划接到当前计划末尾，返回接上后的预测状态 */
    _append(endState, plan) {
      const sim = this._simulate(endState, plan);
      this.plan = this.plan.concat(plan);
      this.path = this.path.concat(sim.pts);
      return sim.end;
    }

    /**
     * 延伸计划：先用前向模型推进到计划末尾，在那里选子目标并搜索、拼接；
     * 找不到安全的延续时，从当前真实状态整体重新规划。
     */
    _extend(game) {
      // 一次延伸里可能连续搜索好几次（末尾 → 真实状态 → 加深 → 终点）：总耗时封顶，免得掉帧
      this.deadline = now() + this.budgetMs * EXTEND_BUDGET;
      try { this._extendPlan(game); } finally { this.deadline = Infinity; }
    }

    _extendPlan(game) {
      let end = game;
      if (this.plan.length) {
        end = this._simulate(game, this.plan).end;
        if (end.state !== 'play') {
          if (end.state === 'dying' || end.state === 'gameover') { this.reset(); end = game; }
          else return; // 计划已抵达旗杆/水管/变身过程中
        }
      }
      // 同一子目标耗时过久就放弃
      if (this.targetFrames > MAX_TARGET_FRAMES && this.target && this.target.type !== 'flag' && this.target.type !== 'exit') {
        this.blacklist.add(this._key(this.target));
        this.target = null;
      }
      const target = this._chooseTarget(end);
      if (!this.target || this._key(target) !== this._key(this.target)) this.targetFrames = 0;
      this.target = target;
      const sub = target.type !== 'flag' && target.type !== 'exit';
      // 从计划末尾延伸时要求至少 minPlan 帧；从真实状态重规划时，短一点的安全前缀也可以接受
      const usable = (r, min) => r.ok || (r.safe && r.plan.length >= min);
      let r = this.search(end, target);
      if (usable(r, this.minPlan)) return this._commit(end, r);
      if (end !== game) {
        // 从计划末尾搜不到：丢掉剩余计划，从当前真实状态再试（多出几帧回旋余地，比如提前刹车）
        this.stats.replans++;
        this.plan = [];
        this.path = [];
        end = game;
        if (!sub || this._valid(game, target)) {
          r = this.search(game, target);
          if (usable(r, MIN_PARTIAL)) return this._commit(game, r);
        }
      }
      if (!sub || this._valid(end, target)) {
        // 加深一次：用 DEEPEN 倍的节点/时间预算再搜（偶尔一帧的停顿，换来跳上高水管这类难动作）
        r = this.search(end, target, DEEPEN);
        if (usable(r, MIN_PARTIAL)) return this._commit(end, r);
      }
      if (sub) {
        // 这个子目标暂时够不着：拉黑，本轮先朝终点走
        this.blacklist.add(this._key(target));
        this.target = this._finalTarget(end);
        this.targetFrames = 0;
        r = this.search(end, this.target);
        if (!usable(r, MIN_PARTIAL)) r = this.search(end, this.target, DEEPEN);
      }
      this._commit(end, r);
    }

    /** 采纳搜索结果：达成子目标的完整采纳；部分计划只取开头一段（滚动时域） */
    _commit(state, r) {
      const after = this._append(state, r.ok ? r.plan : r.plan.slice(0, PARTIAL_MAX));
      if (r.goal) {
        this.stats.goals++;
        this._maybeIdle(after);
      }
    }

    /** 拟人：完成子目标后偶尔停顿片刻（先确认停顿期间不会受伤/死亡、附近没有敌人） */
    _maybeIdle(state) {
      if (!this.persona.human || state.state !== 'play' || !state.mario.onGround || this.rand() > 0.3) return;
      const m = state.mario;
      if (state.enemies.some(e => e.state !== 'dead' && e.state !== 'flat' && Math.abs(e.x - m.x) < 112)) return;
      const frames = 12 + Math.floor(this.rand() * 24);
      const idle = [];
      for (let i = 0; i < frames; i++) idle.push({});
      const sim = this._simulate(state, idle);
      if (sim.end.state !== 'play' || sim.end.mario.big !== m.big) return;
      this.stats.idles++;
      this._append(state, idle);
    }

    /**
     * 叠加层数据：剩余计划路线 + 当前子目标在真实游戏中的位置。
     * @returns {{path:object[], target:object|null, persona:string}}
     */
    view(game) {
      let target = null;
      const t = this.target;
      if (t && t.area === game.area.id) {
        let box = null;
        if (t.type === 'item') { const it = game.items.find(i => i.id === t.id); if (it) box = { x: it.x, y: it.y, w: 16, h: 16 }; }
        else if (t.type === 'stomp' || t.type === 'kick') {
          const e = game.enemies.find(i => i.id === t.id);
          if (e) { const tall = e.kind === 'koopa' && e.state === 'walk'; box = { x: e.x, y: tall ? e.y - 8 : e.y, w: 16, h: tall ? 24 : 16 }; }
        } else if (t.type === 'pipe') box = { x: t.tx * 16, y: t.ty * 16, w: 32, h: 16 };
        else if (t.type === 'flag') box = { x: t.tx * 16 + 4, y: t.ty * 16, w: 8, h: (12 - t.ty) * 16 };
        else if (t.type === 'exit') box = { x: t.tx * 16, y: t.ty * 16, w: 16, h: 32 };
        else box = { x: t.tx * 16, y: t.ty * 16, w: 16, h: 16 };
        if (box) target = Object.assign(box, { label: t.label });
      }
      return { path: this.path.filter(p => p.area === game.area.id), target, persona: this.persona.name };
    }
  }

  MarioAutoPilot.ACTIONS = ACTIONS;
  MarioAutoPilot.PERSONAS = PERSONAS;
  MarioAutoPilot.PERSONA_ORDER = PERSONA_ORDER;
  DOS.MarioAutoPilot = MarioAutoPilot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
