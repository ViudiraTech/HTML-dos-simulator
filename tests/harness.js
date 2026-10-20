/*
 * 极简测试框架（无依赖）：Node 与浏览器共用。
 *   test(name, fn)    注册测试（fn 可为 async）
 *   assert(cond, msg) / eq(actual, expected, msg) / includes(text, part, msg)
 *   run(log)          依次运行，返回 {passed, failed}
 */
(function (root) {
  'use strict';
  const tests = [];

  class AssertionError extends Error {}

  const T = {
    test(name, fn) { tests.push({ name, fn }); },
    assert(cond, msg) { if (!cond) throw new AssertionError(msg || 'assertion failed'); },
    eq(actual, expected, msg) {
      const a = JSON.stringify(actual), e = JSON.stringify(expected);
      if (a !== e) throw new AssertionError(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
    },
    includes(text, part, msg) {
      if (!String(text).includes(part)) throw new AssertionError(`${msg ? msg + ': ' : ''}expected to contain ${JSON.stringify(part)}\n--- actual ---\n${text}`);
    },
    notIncludes(text, part, msg) {
      if (String(text).includes(part)) throw new AssertionError(`${msg ? msg + ': ' : ''}expected NOT to contain ${JSON.stringify(part)}`);
    },
    async run(log = console.log, filter = '') {
      let passed = 0, failed = 0;
      for (const t of tests) {
        if (filter && !t.name.toLowerCase().includes(filter.toLowerCase())) continue;
        const t0 = Date.now();
        try {
          await t.fn();
          passed++;
          log(`  ok   ${t.name} (${Date.now() - t0}ms)`, 'pass');
        } catch (e) {
          failed++;
          const detail = e instanceof AssertionError ? e.message : (e && e.stack || String(e)).split('\n').slice(0, 5).join('\n');
          log(`  FAIL ${t.name}\n       ${detail.split('\n').join('\n       ')}`, 'fail');
        }
      }
      log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`, failed ? 'fail' : 'pass');
      return { passed, failed };
    }
  };

  root.TestHarness = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof globalThis !== 'undefined' ? globalThis : this);
