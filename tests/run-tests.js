#!/usr/bin/env node
/*
 * Node 测试入口：node tests/run-tests.js [过滤关键字]
 * 不依赖任何第三方库。
 */
'use strict';
require('./load.js');
const T = require('./harness.js');
require('./tests.js');

T.run(console.log, process.argv[2] || '').then(({ failed }) => {
  process.exitCode = failed ? 1 : 0;
});
