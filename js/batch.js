/*
 * Batch —— .BAT 批处理解释器（Parser 模块的一部分）
 * ---------------------------------------------------------------
 * 批处理上下文保存在 Machine.batchStack 中：
 *   - 直接执行另一个 .BAT（不经 CALL）会替换栈顶（DOS 的“链式”语义）；
 *   - CALL 压栈并运行嵌套循环，直到返回原深度；
 *   - GOTO 修改栈顶的 ip；Ctrl+C 时询问 "Terminate batch job (Y/N)?"。
 * 每执行一行都会让出事件循环，保证死循环的批处理也能被 Ctrl+C 打断。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const Batch = {
    /**
     * 运行批处理文件。
     * @param {object} m Machine
     * @param {string} path 绝对路径
     * @param {string[]} args 参数，args[0] 为 %0
     * @param {{call?:boolean}} [opts]
     */
    async run(m, path, args, opts = {}) {
      let text;
      try { text = m.fs.readText(path); } catch (e) { m.outln('Batch file missing'); return; }
      const ctx = { path, args: args.slice(), lines: text.split(/\r?\n/), ip: 0 };
      if (m.batchStack.length && !opts.call) {
        m.batchStack[m.batchStack.length - 1] = ctx;
        return;
      }
      m.batchStack.push(ctx);
      await Batch.loop(m, m.batchStack.length - 1);
    },

    /**
     * 执行循环：直到栈深度回到 base。
     * @param {object} m
     * @param {number} base
     */
    async loop(m, base) {
      try {
        while (m.batchStack.length > base) {
          const ctx = m.batchStack[m.batchStack.length - 1];
          if (ctx.ip >= ctx.lines.length) { m.batchStack.pop(); continue; }
          const raw = ctx.lines[ctx.ip++];
          await m.yieldNow();
          try {
            if (m.breakFlag) throw new DOS.BreakError();
            await Batch.executeLine(m, ctx, raw);
            if (m.breakFlag) throw new DOS.BreakError();
          } catch (e) {
            if (!(e instanceof DOS.BreakError)) throw e;
            if (await Batch.confirmTerminate(m)) m.batchStack.length = 0;
          }
        }
      } finally {
        if (base === 0) m.echo = true;
      }
    },

    /**
     * 执行批处理中的一行。
     * @param {object} m
     * @param {object} ctx 批处理上下文
     * @param {string} raw 原始行
     */
    async executeLine(m, ctx, raw) {
      let line = raw.replace(/^\s+/, '');
      if (!line || line[0] === ':') return; // 标签与 :: 注释
      line = DOS.Parser.expandVars(line, n => m.getEnv(n), ctx.args);
      let silent = false;
      if (line[0] === '@') { silent = true; line = line.slice(1); }
      if (!line.trim()) return;
      if (m.echo && !silent) {
        m.term.ensureLineStart();
        m.out('\n' + m.promptString() + line + '\n');
      }
      await m.execute(line, { expanded: true, batch: ctx });
    },

    /**
     * 询问是否终止批处理。
     * @returns {Promise<boolean>} true = 终止
     */
    async confirmTerminate(m) {
      m.breakFlag = false;
      m.input.flush();
      m.term.ensureLineStart();
      m.term.write('^C\n');
      for (;;) {
        m.term.write('Terminate batch job (Y/N)? ');
        const ev = await m.input.readKey();
        m.breakFlag = false;
        if (ev.key === 'Break') { m.term.write('\n'); continue; }
        const c = (ev.char || '').toUpperCase();
        if (c === 'Y' || c === 'N') { m.term.write(c + '\n'); return c === 'Y'; }
        m.term.write('\n');
      }
    },

    /**
     * 查找标签所在行号。
     * @returns {number} 未找到返回 -1
     */
    findLabel(ctx, label) {
      const want = label.replace(/^:/, '').trim().split(/\s+/)[0].toUpperCase();
      if (!want) return -1;
      for (let i = 0; i < ctx.lines.length; i++) {
        const l = ctx.lines[i].trim();
        if (l[0] === ':' && l[1] !== ':' && l.slice(1).trim().split(/\s+/)[0].toUpperCase() === want) return i;
      }
      return -1;
    }
  };

  DOS.Batch = Batch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
