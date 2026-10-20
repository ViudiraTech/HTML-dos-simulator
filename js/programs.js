/*
 * Programs —— 外部程序注册表（.COM/.EXE 存根签名 → JS 实现）
 * ---------------------------------------------------------------
 * 程序约定：{ id, help, run: async (m, args) => exitCode }
 * 图形程序调用 m.enterGraphics()；返回或抛出后 Machine 自动回到文本模式
 * 并恢复原屏幕内容。Esc 或 Ctrl+C 退出。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const registry = new Map();

  const Programs = {
    /** 注册程序 */
    register(def) { registry.set(def.id, def); },
    /** 按 ID 取程序 */
    get(id) { return registry.get(String(id).toUpperCase()) || null; },
    /** 所有程序 ID */
    ids() { return Array.from(registry.keys()); },

    /**
     * 图形程序通用：检查是否应退出（Esc 或 Ctrl+C）。会消费键盘队列。
     * @param {object} m Machine
     * @param {function(object):void} [onKey] 处理其他按键事件
     * @returns {boolean}
     */
    shouldExit(m, onKey) {
      let exit = m.breakFlag;
      let ev;
      while ((ev = m.input.pollKey())) {
        if (ev.key === 'Escape' || ev.key === 'Break') exit = true;
        else if (onKey) onKey(ev);
      }
      return exit || m.input.isDown('Escape');
    }
  };

  Programs.register({
    id: 'COMMAND',
    help: 'Starts a new copy of the MS-DOS command interpreter.\n\nCOMMAND [/C string]\n\n  /C string  Carries out the command specified by string, and then stops.',
    async run(m, args) {
      const mm = /\/C\s+(.*)$/i.exec(args.raw || '');
      if (mm) { await m.execute(mm[1]); return 0; }
      m.outln('');
      m.outln(`MS-DOS Version ${m.version}`);
      m.outln('             (C)Copyright HTML-DOS Project 2026.');
      m.outln('The command interpreter is already running in this window.');
      return 0;
    }
  });

  Programs.register({
    id: 'PLASMA',
    help: 'PLASMA.COM - palette-cycling plasma demo for VGA mode 13h.\n\nPLASMA\n\nPress Esc to return to DOS.',
    async run(m) {
      m.enterGraphics(320, 200);
      const g = m.gfx, W = 320, H = 200;
      const sin = new Float32Array(512);
      for (let i = 0; i < 512; i++) sin[i] = Math.sin(i * Math.PI * 2 / 256);
      const dist = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dist[y * W + x] = Math.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2);
      let t = 0;
      while (!Programs.shouldExit(m)) {
        // 调色板循环：1..254 为彩虹，0 = 黑，255 = 白（文字）
        for (let i = 1; i < 255; i++) {
          const a = (i * 3 + t * 2) * Math.PI / 254;
          g.setPalette(i, 128 + 127 * Math.sin(a), 128 + 127 * Math.sin(a + 2.1), 128 + 127 * Math.sin(a + 4.2));
        }
        g.setPalette(255, 255, 255, 255);
        const back = g.back;
        for (let y = 0; y < H; y++) {
          const sy = sin[(y * 2 + t) & 255];
          for (let x = 0; x < W; x++) {
            const v = sin[(x + t * 2) & 255] + sy + sin[((x + y) + t) & 255] + Math.sin(dist[y * W + x] / 8 - t / 20);
            back[y * W + x] = 1 + (((v + 4) * 31.6) | 0) % 254;
          }
        }
        g.fillRect(0, 190, W, 10, 0);
        g.text('PLASMA.COM  Mode 13h  -  Esc = exit', 20, 191, 255);
        g.swap();
        await g.waitVBlank();
        t++;
      }
      return 0;
    }
  });

  Programs.register({
    id: 'BALL',
    help: 'BALL.COM - bouncing balls demo for VGA mode 13h.\n\nBALL\n\nArrow keys change gravity, Space adds a ball, C clears, Esc exits.',
    async run(m) {
      m.enterGraphics(320, 200);
      const g = m.gfx;
      const balls = [];
      const colors = [9, 10, 11, 12, 13, 14, 40, 44, 52, 34];
      const add = () => {
        if (balls.length >= 40) return;
        balls.push({ x: 40 + Math.random() * 240, y: 30 + Math.random() * 60, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 4, r: 5 + Math.random() * 9, c: colors[balls.length % colors.length] });
      };
      for (let i = 0; i < 6; i++) add();
      // 8×8 星形位图，用于验证 blit（0 为透明）
      const star = { w: 8, h: 8, data: new Uint8Array([
        0, 0, 0, 14, 14, 0, 0, 0,
        0, 0, 0, 14, 14, 0, 0, 0,
        14, 14, 14, 15, 15, 14, 14, 14,
        0, 14, 15, 15, 15, 15, 14, 0,
        0, 0, 14, 15, 15, 14, 0, 0,
        0, 14, 15, 14, 14, 15, 14, 0,
        0, 14, 14, 0, 0, 14, 14, 0,
        14, 0, 0, 0, 0, 0, 0, 14]) };
      let last = Date.now(), frame = 0;
      const box = { x0: 8, y0: 18, x1: 312, y1: 182 };
      while (!Programs.shouldExit(m, ev => {
        if (ev.key === ' ') add();
        if (ev.key === 'c' || ev.key === 'C') balls.length = 0;
      })) {
        const now = Date.now();
        const dt = Math.min(3, (now - last) / (1000 / 60));
        last = now;
        frame++;
        const gx = (m.input.isDown('ArrowRight') ? 0.35 : 0) - (m.input.isDown('ArrowLeft') ? 0.35 : 0);
        let gy = (m.input.isDown('ArrowDown') ? 0.35 : 0) - (m.input.isDown('ArrowUp') ? 0.35 : 0);
        if (!gx && !gy) gy = 0.2;
        for (const b of balls) {
          b.vx += gx * dt; b.vy += gy * dt;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x - b.r < box.x0) { b.x = box.x0 + b.r; b.vx = Math.abs(b.vx) * 0.92; }
          if (b.x + b.r > box.x1) { b.x = box.x1 - b.r; b.vx = -Math.abs(b.vx) * 0.92; }
          if (b.y - b.r < box.y0) { b.y = box.y0 + b.r; b.vy = Math.abs(b.vy) * 0.92; }
          if (b.y + b.r > box.y1) { b.y = box.y1 - b.r; b.vy = -Math.abs(b.vy) * 0.92; }
        }
        // 球与球之间的简单弹性碰撞
        for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i], b = balls[j];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
          if (d > 0 && d < min) {
            const nx = dx / d, ny = dy / d, push = (min - d) / 2;
            a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel < 0) { a.vx += rel * nx; a.vy += rel * ny; b.vx -= rel * nx; b.vy -= rel * ny; }
          }
        }
        g.clear(1);
        for (let x = box.x0; x <= box.x1; x += 16) g.line(x, box.y0, x, box.y1, 17);
        for (let y = box.y0; y <= box.y1; y += 16) g.line(box.x0, y, box.x1, y, 17);
        g.rect(box.x0 - 1, box.y0 - 1, box.x1 - box.x0 + 3, box.y1 - box.y0 + 3, 15);
        for (const b of balls) {
          g.fillCircle(b.x + 3, b.y + 3, b.r, 0);
          g.fillCircle(b.x, b.y, b.r, b.c);
          g.circle(b.x, b.y, b.r, 15);
          g.fillCircle(b.x - b.r / 3, b.y - b.r / 3, Math.max(1, b.r / 4), 15);
        }
        g.blit(star, 300, 4 + (frame >> 3) % 2, { flipX: (frame >> 4) % 2 === 1 });
        g.fillRect(0, 186, 320, 14, 0);
        g.text(`BALLS:${String(balls.length).padStart(2, '0')}  ARROWS=GRAVITY SPC=ADD`, 4, 4, 15);
        // 按键状态指示（验证图形模式下的按键查询）
        const keys = [['ArrowLeft', '◄', 4], ['ArrowUp', '▲', 14], ['ArrowDown', '▼', 24], ['ArrowRight', '►', 34]];
        for (const [code, ch, x] of keys) g.text(ch, x, 189, m.input.isDown(code) ? 14 : 8);
        g.text('C=CLEAR  ESC=EXIT', 180, 189, 7);
        g.swap();
        await g.waitVBlank();
      }
      return 0;
    }
  });

  Programs.register({
    id: 'MARIO',
    help: [
      'MARIO.COM - a World 1-1 tribute platform game (Mode 13h, 256 colours).',
      '',
      'MARIO [/M]',
      '',
      '  /M   No background music (sound effects only)',
      '',
      'Keys:',
      '  Left / Right  (or A / D)   walk',
      '  Down          (or S)       crouch / enter a pipe',
      '  Z or Space                 jump  (A button, hold to jump higher)',
      '  X or Shift                 run   (B button)',
      '  Enter                      start / pause',
      '  Esc                        quit to DOS',
      '',
      'Original pixel art and music; a fan tribute not affiliated with Nintendo.'
    ].join('\n'),
    async run(m, args) {
      return DOS.MarioProgram.run(m, args);
    }
  });

  DOS.Programs = Programs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
