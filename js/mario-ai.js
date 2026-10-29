/*
 * MarioAI —— MARIO.COM 的自动驾驶（自动通关）
 * ---------------------------------------------------------------
 * 思路参考 2009 年 Mario AI Competition 冠军、Robin Baumgarten 的 A* 智能体：
 *   - 前向模型：直接克隆 MarioGame（MarioGame.clone()），用游戏自身的物理推进，
 *     因此预测与实际完全一致（游戏逻辑是确定性的）；
 *   - 动作集：{左/右/不动} × {跳} × {跑}，每个搜索节点把一个动作重复 REPEAT 帧；
 *   - 优先级 f = 已用帧数 × 0.9 + 以最高速度到达终点的剩余帧数 + 受伤惩罚；
 *   - 死亡（被敌人撞死、掉坑）的分支直接剪掉；相近状态（位置/速度）只展开一次；
 *   - 节点惰性求值：出队时才模拟，若真实代价明显变差则重新入队；
 *   - 计划在执行中保留；剩余不足 minPlan 帧时从计划末尾的预测状态继续搜索并拼接，
 *     找不到安全延续时再从当前状态整体重新规划；每次搜索有时间/节点预算。
 * 规划达到视野（向前 176px）或抵达旗杆/出口水管即停止；否则退回“最远且站在地面上”的节点。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const REPEAT = 2;          // 每个节点重复同一动作的帧数
  const HORIZON = 176;       // 规划视野（像素）
  const GROUND_Y = 13 * 16;  // 地面顶端
  const DAMAGE_PENALTY = 5000;
  const CLIMB_SPEED = 2.5;   // 估算爬升代价时的平均上升速度（像素/帧）

  /** 动作集（与 MarioGame.step 的输入格式一致） */
  const ACTIONS = [
    { right: true, b: true }, { right: true, b: true, a: true },
    { right: true }, { right: true, a: true },
    { left: true, b: true }, { left: true, b: true, a: true },
    { left: true }, { left: true, a: true },
    { a: true }, {}
  ];

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

  class MarioAutoPilot {
    /**
     * @param {object} [opts]
     * @param {number} [opts.budgetMs=6]  每次搜索的时间预算（浏览器中避免卡帧；测试中设为 Infinity 以保证确定性）
     * @param {number} [opts.maxNodes=300] 每次搜索最多模拟的节点数
     * @param {number} [opts.minPlan=12]   剩余计划少于这么多帧时向前延伸规划
     * @param {boolean} [opts.strict=false] true 时只接受到达视野的延伸（更保守、更慢）
     */
    constructor(opts = {}) {
      this.budgetMs = opts.budgetMs === undefined ? 6 : opts.budgetMs;
      this.maxNodes = opts.maxNodes || 300;
      this.minPlan = opts.minPlan || 12;
      this.repeat = opts.repeat || REPEAT;
      this.weight = opts.weight === undefined ? 0.9 : opts.weight;
      this.climbSpeed = opts.climbSpeed || CLIMB_SPEED;
      this.look = opts.look === undefined ? 2 : opts.look;
      this.strict = opts.strict === true;
      this.actions = opts.actions || ACTIONS;
      this.plan = [];
      this.stats = { searches: 0, nodes: 0, lastNodes: 0, lastMs: 0, reachedHorizon: 0, replans: 0 };
    }

    /** 清空已有计划（开关自动驾驶或关卡重开时） */
    reset() { this.plan = []; }

    /**
     * 计算本帧应给出的输入。
     * @param {object} game MarioGame
     * @returns {object} 输入 {left,right,up,down,a,b,start}
     */
    next(game) {
      if (game.state === 'title') return { start: game.frame % 2 === 0 };
      if (game.state !== 'play' || game.paused) { this.reset(); return {}; }
      if (this.plan.length < this.minPlan) this._extend(game);
      return Object.assign({}, this.plan.shift() || { right: true, b: true });
    }

    /**
     * 延伸计划。游戏是确定性的，已有计划在执行时不会“走样”，所以先用前向模型
     * 推进到计划末尾，再从那里继续搜索并拼接（相当于 Baumgarten 的提前规划）；
     * 若末尾状态找不到安全的延续，则从当前真实状态完整重新规划（回溯）。
     */
    _extend(game) {
      if (this.plan.length) {
        const end = game.clone();
        for (const a of this.plan) end.step(a);
        if (end.state === 'play') {
          const r = this.search(end);
          if (r.ok || (!this.strict && r.plan.length >= this.minPlan)) { this.plan = this.plan.concat(r.plan); return; }
        } else if (end.state !== 'dying' && end.state !== 'gameover') return; // 计划已抵达旗杆/水管
      }
      this.stats.replans++;
      this.plan = this.search(game).plan;
    }

    /** 当前区域的目标 x：主关卡为旗杆，地下奖励房为侧向出口水管 */
    _goalX(game) {
      const def = game.area.def;
      if (def.sidePipe) return def.sidePipe.x * 16;
      if (def.flag) return def.flag.x * 16 + 8;
      return game.area.w * 16;
    }

    /**
     * 前方墙体还需爬升的高度（像素）：检查马里奥前方 3 列，从脚下那一行向上数连续的实心图块。
     * 原版 A* 只用水平距离做启发值，遇到需要原地起跳的高水管时会大量展开“原地不动”的节点；
     * 加入这一项后，起跳上升本身就被视为进展。
     */
    _climb(g) {
      const m = g.mario;
      const bottom = m.y + m.h;
      const feetRow = Math.floor((bottom - 1) / 16);
      const front = Math.floor((m.x + m.w) / 16);
      let need = 0;
      for (let cx = front; cx <= front + this.look; cx++) {
        let row = feetRow;
        if (!g._solid(cx, row)) continue;
        while (row > 0 && g._solid(cx, row - 1)) row--;
        need = Math.max(need, bottom - row * 16);
      }
      return need;
    }

    /**
     * 从当前水平速度出发、以奔跑加速度加速到最高速，走完 dist 像素所需的帧数。
     * 与 Baumgarten 的 maxForwardMovement 同理：只用“最高速度”估计会让刚落地/起步的
     * 状态显得代价过高，A* 退化为广度优先。
     */
    _timeToCover(dist, vx, P) {
      if (dist <= 0) return 0;
      const a = P.runAccel, vmax = P.maxRun;
      let extra = 0, v = vx;
      if (v < 0) { extra = -v / P.skidDecel; v = 0; } // 先刹车掉向左的速度
      v = Math.max(v, P.minWalk);
      const ta = (vmax - v) / a;
      const da = v * ta + 0.5 * a * ta * ta;
      if (dist <= da) return extra + (-v + Math.sqrt(v * v + 2 * a * dist)) / a;
      return extra + ta + (dist - da) / vmax;
    }

    /** 评估模拟后的节点：设置 dead / goal / f */
    _evaluate(node, goalX, startBig) {
      const g = node.state, m = g.mario, P = g.P;
      if (g.state === 'flag' || (g.state === 'pipe' && g.pipe && g.pipe.dir === 'right')) {
        node.goal = true;
        node.f = node.t * this.weight;
        return;
      }
      const falling = !m.onGround && m.y + m.h > GROUND_Y + 2 && g.state === 'play';
      if (g.state === 'dying' || g.state === 'gameover' || falling) { node.dead = true; node.f = Infinity; return; }
      const damaged = (startBig && !m.big) || (g.state === 'transform' && g.transform && g.transform.kind === 'shrink');
      const remaining = this._timeToCover(Math.max(0, goalX - m.x), m.vx, P) + this._climb(g) / this.climbSpeed;
      node.f = node.t * this.weight + remaining + (damaged ? DAMAGE_PENALTY : 0);
    }

    /**
     * A* 搜索：返回逐帧输入序列。
     * @param {object} game 起点状态（不会被修改）
     * @returns {{plan:object[], ok:boolean}} ok 表示到达了视野或终点
     */
    search(game) {
      const t0 = now();
      const goalX = this._goalX(game);
      const startBig = game.mario.big;
      const root = { state: game.clone(), parent: null, action: null, t: 0, f: 0 };
      this._evaluate(root, goalX, startBig);
      const x0 = root.state.mario.x;
      const open = new Heap();
      const visited = new Set();
      let best = null, furthest = null, furthestGround = null, sims = 0;

      const expand = (node) => {
        const m = node.state.mario, prevA = !!node.state.prev.a;
        // 地面：A 仍按着时无法再次起跳；空中：只有上升且按住 A 时 A 才有意义
        const canJump = m.onGround ? !prevA : (m.holdJump && m.vy < 0);
        for (const action of this.actions) {
          if (action.a && !canJump) continue;
          if (!m.onGround && action.b) continue; // 空中 B 不影响速度（空中速度上限在起跳时确定），属于重复分支
          open.push({ state: null, parent: node, action, t: node.t + this.repeat, f: node.f });
        }
      };
      expand(root);

      while (open.size && sims < this.maxNodes && now() - t0 < this.budgetMs) {
        const node = open.pop();
        if (!node.state) {
          // 惰性求值：出队时才用前向模型模拟
          node.state = node.parent.state.clone();
          for (let i = 0; i < this.repeat; i++) node.state.step(node.action);
          sims++;
          this._evaluate(node, goalX, startBig);
          if (node.dead) continue;
          if (open.size && node.f > open.peek().f + 0.1) { open.push(node); continue; }
        }
        if (node.goal) { best = node; break; }
        const m = node.state.mario;
        // 状态键必须包含“A 是否仍按着/是否还能延长跳跃”，否则按住 A 的站立状态会把可起跳的同位置状态剪掉
        const key = `${Math.round(m.x / 2)},${Math.round(m.y / 2)},${Math.round(m.vx * 4)},${Math.round(m.vy)},${node.state.prev.a ? 1 : 0}${m.holdJump ? 1 : 0},${node.state.area.id}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (!furthest || m.x > furthest.state.mario.x) furthest = node;
        if (m.onGround && node.state.state === 'play' && (!furthestGround || m.x > furthestGround.state.mario.x)) furthestGround = node;
        if (m.x - x0 >= HORIZON) { best = node; this.stats.reachedHorizon++; break; }
        expand(node);
      }

      this.stats.searches++;
      this.stats.nodes += sims;
      this.stats.lastNodes = sims;
      this.stats.lastMs = now() - t0;
      // 未达到视野时优先选“站在地面上”的最远节点，避免把计划停在坑的半空中
      const target = best || furthestGround || furthest;
      if (!target) return { plan: [{ right: true, b: true }], ok: false };
      const plan = [];
      for (let n = target; n.parent; n = n.parent) for (let i = 0; i < this.repeat; i++) plan.unshift(n.action);
      return { plan, ok: !!best };
    }
  }

  MarioAutoPilot.ACTIONS = ACTIONS;
  DOS.MarioAutoPilot = MarioAutoPilot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
