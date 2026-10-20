/*
 * HTML-DOS 单元测试（Node 与浏览器共用）。
 * 覆盖：Parser、FileSystem、批处理解释器、内置命令、行编辑、Graphics、
 *       MarioGame 物理（短跳/长跳、踩踏、侧撞、掉坑、蘑菇变大/受伤变小）与自动通关。
 */
(function (root) {
  'use strict';
  const { test, assert, eq, includes, notIncludes } = root.TestHarness;
  const DOS = root.DOS;

  class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** 新建无头机器 */
  function mk(storage) { return new DOS.Machine({ storage: storage || new MemoryStorage(), headless: true }); }

  /** 执行一条命令并返回屏幕输出（keys 为预先注入的按键） */
  async function run(m, line, keys) {
    m.term.scrollback = [];
    m.term.clear();
    if (keys) m.input.feed(keys);
    await m.runInteractive(line);
    return m.term.allText();
  }

  // ==================================================================
  // Parser
  // ==================================================================

  test('Parser.tokenize keeps quoted spaces', () => {
    eq(DOS.Parser.tokenize('a "b c" d'), ['a', 'b c', 'd']);
    eq(DOS.Parser.tokenize('x,y;z=w'), ['x', 'y', 'z', 'w']);
  });

  test('Parser.splitCommand handles CD.., ECHO., DIR/W and paths', () => {
    const isInt = n => DOS.Commands.has(n);
    eq(DOS.Parser.splitCommand('CD..', isInt), { name: 'CD', rest: '..', internal: true });
    eq(DOS.Parser.splitCommand('echo.', isInt).rest, '.');
    eq(DOS.Parser.splitCommand('DIR/W', isInt), { name: 'DIR', rest: '/W', internal: true });
    eq(DOS.Parser.splitCommand('cd\\games', isInt).rest, '\\games');
    eq(DOS.Parser.splitCommand('MARIO.COM /M', isInt).internal, false);
    eq(DOS.Parser.splitCommand('C:\\GAMES\\BALL.COM', isInt).name, 'C:\\GAMES\\BALL.COM');
  });

  test('Parser.parseArgs parses switches', () => {
    const a = DOS.Parser.parseArgs(' *.TXT/W /A:H /-Y /p');
    eq(a.params, ['*.TXT']);
    eq(a.switches.W, '');
    eq(a.switches.A, 'H');
    eq(a.switches['-Y'], '');
    eq(a.switches.P, '');
    eq(DOS.Parser.parseArgs('/AH').switches.A, 'H');
  });

  test('Parser.expandVars: command line vs batch', () => {
    const env = n => ({ PATH: 'C:\\DOS', X: '1' })[n];
    eq(DOS.Parser.expandVars('echo %PATH% %NOPE%', env, null), 'echo C:\\DOS %NOPE%');
    eq(DOS.Parser.expandVars('echo %PATH% %NOPE%', env, []), 'echo C:\\DOS ');
    eq(DOS.Parser.expandVars('%0 %1 %2 %* 100%%', env, ['T.BAT', 'a', 'b']), 'T.BAT a b a b 100%');
    eq(DOS.Parser.expandVars('FOR %%A IN (1) DO ECHO %%A', env, ['X']), 'FOR %A IN (1) DO ECHO %A');
  });

  test('Parser.parsePipeline: redirection and pipes', () => {
    const p = DOS.Parser.parsePipeline('type a.txt | find "x" >> out.txt');
    eq(p.length, 2);
    eq(p[0].line, 'type a.txt');
    eq(p[1], { line: 'find "x"', input: null, output: 'out.txt', append: true });
    eq(DOS.Parser.parsePipeline('sort < in.txt > o.txt')[0], { line: 'sort', input: 'in.txt', output: 'o.txt', append: false });
    eq(DOS.Parser.parsePipeline('echo "a>b"')[0].line, 'echo "a>b"');
  });

  test('Parser.parseIf: ERRORLEVEL, EXIST, compare, NOT', () => {
    eq(DOS.Parser.parseIf('ERRORLEVEL 2 GOTO x'), { not: false, type: 'errorlevel', level: 2, command: 'GOTO x' });
    eq(DOS.Parser.parseIf('NOT EXIST A.TXT ECHO no').type, 'exist');
    const c = DOS.Parser.parseIf('""=="" GOTO end');
    eq([c.a, c.b, c.command], ['""', '""', 'GOTO end']);
    const d = DOS.Parser.parseIf('NOT "%1" == "x" echo hi');
    eq([d.not, d.a, d.b], [true, '"%1"', '"x"']);
    let threw = false;
    try { DOS.Parser.parseIf('foo bar'); } catch (e) { threw = true; }
    assert(threw, 'syntax error expected');
  });

  test('Parser.parseFor and expandPrompt', () => {
    eq(DOS.Parser.parseFor('%A IN (a b,c) DO ECHO %A'), { variable: 'A', items: ['a', 'b', 'c'], command: 'ECHO %A' });
    const info = { cwd: 'C:\\GAMES', drive: 'C', version: 'v', date: 'd', time: 't' };
    eq(DOS.Parser.expandPrompt('$P$G', info), 'C:\\GAMES>');
    eq(DOS.Parser.expandPrompt('$N$G', info), 'C>');
    eq(DOS.Parser.expandPrompt('[$P]$_$$$G', info), '[C:\\GAMES]\n$>');
  });

  test('wildMatch implements DOS * and ?', () => {
    const w = DOS.FileSystem.wildMatch;
    assert(w('README.TXT', '*.TXT'));
    assert(!w('README.BAT', '*.TXT'));
    assert(w('BALL.COM', 'B?LL.*'));
    assert(w('A.TXT', '*.*') && w('NOEXT', '*.*'));
    assert(w('NOEXT', '*'));
    assert(w('README.TXT', 'readme.txt'));
    assert(!w('README.TXT', 'README'));
  });

  // ==================================================================
  // FileSystem
  // ==================================================================

  test('FileSystem: default disk layout', () => {
    const fs = new DOS.FileSystem({ storage: new MemoryStorage() });
    for (const p of ['C:\\COMMAND.COM', 'C:\\AUTOEXEC.BAT', 'C:\\README.TXT', 'C:\\GAMES\\PLASMA.COM', 'C:\\GAMES\\BALL.COM', 'C:\\MARIO\\MARIO.COM']) assert(fs.isFile(p), p);
    for (const p of ['C:\\GAMES', 'C:\\UTILS', 'C:\\MARIO']) assert(fs.isDir(p), p);
    eq(fs.list('A:\\').length, 0, 'A: is an empty floppy');
    eq(DOS.DiskImage.programId(fs.readBytes('C:\\MARIO\\MARIO.COM')), 'MARIO');
  });

  test('FileSystem: 8.3 names, case-insensitive, uppercase display', () => {
    const V = DOS.FileSystem.validName;
    assert(V('README.TXT') && V('A') && V('ABCDEFGH.ABC'));
    assert(!V('ABCDEFGHI.TXT') && !V('A.TOOL') && !V('A B.TXT') && !V('A.B.C') && !V('CON') && !V('A*.TXT'));
    const fs = new DOS.FileSystem({ storage: new MemoryStorage() });
    fs.writeText('c:\\temp\\hello.txt', 'hi');
    eq(fs.readText('C:\\TEMP\\HELLO.TXT'), 'hi');
    eq(fs.list('c:\\temp').map(e => e.name), ['HELLO.TXT']);
    let code = null;
    try { fs.writeText('toolongname.txt', 'x'); } catch (e) { code = e.code; }
    eq(code, 'INVALID_NAME');
  });

  test('FileSystem: path resolution, .. at root, drives', () => {
    const fs = new DOS.FileSystem({ storage: new MemoryStorage() });
    eq(fs.format(fs.resolve('..')), 'C:\\');
    fs.chdir('GAMES');
    eq(fs.getCwd(), 'C:\\GAMES');
    eq(fs.format(fs.resolve('..\\UTILS\\DEMO.BAT')), 'C:\\UTILS\\DEMO.BAT');
    eq(fs.format(fs.resolve('\\MARIO')), 'C:\\MARIO');
    eq(fs.format(fs.resolve('A:FOO')), 'A:\\FOO');
    let code = null;
    try { fs.resolve('Q:\\X'); } catch (e) { code = e.code; }
    eq(code, 'INVALID_DRIVE');
  });

  test('FileSystem: mkdir/rmdir, recursive delete, current dir protection', () => {
    const fs = new DOS.FileSystem({ storage: new MemoryStorage() });
    fs.mkdir('X');
    fs.mkdir('X\\Y');
    fs.writeText('X\\Y\\F.TXT', 'data');
    let code = null;
    try { fs.rmdir('X'); } catch (e) { code = e.code; }
    eq(code, 'NOT_EMPTY');
    fs.chdir('X\\Y');
    code = null;
    try { fs.rmdir('C:\\X', { recursive: true }); } catch (e) { code = e.code; }
    eq(code, 'CURRENT_DIR');
    fs.chdir('\\');
    fs.rmdir('X', { recursive: true });
    assert(!fs.exists('X'));
  });

  test('FileSystem: binary files stored as Base64 round-trip', () => {
    const fs = new DOS.FileSystem({ storage: new MemoryStorage() });
    const bytes = new Uint8Array(300);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 255;
    fs.writeBytes('BIN.DAT', bytes);
    const st = fs.stat('BIN.DAT');
    assert(st.node.binary && /^[A-Za-z0-9+/=]+$/.test(st.node.data), 'stored as base64');
    eq(st.size, 300);
    eq(Array.from(fs.readBytes('BIN.DAT')), Array.from(bytes));
  });

  test('FileSystem: persistence across instances and FORMAT', () => {
    const storage = new MemoryStorage();
    const fs1 = new DOS.FileSystem({ storage });
    fs1.writeText('KEEP.TXT', 'persist me');
    fs1.mkdir('A:\\DISK');
    fs1.chdir('GAMES');
    const fs2 = new DOS.FileSystem({ storage });
    eq(fs2.readText('C:\\KEEP.TXT'), 'persist me');
    assert(fs2.isDir('A:\\DISK'));
    eq(fs2.getCwd(), 'C:\\GAMES');
    fs2.formatDrive('C');
    const fs3 = new DOS.FileSystem({ storage });
    eq(fs3.list('C:\\').length, 0, 'C: empty after format');
    eq(fs3.getCwd(), 'C:\\');
  });

  test('FileSystem: read-only attribute and disk-full', () => {
    const fs = new DOS.FileSystem({ storage: new MemoryStorage() });
    fs.writeText('RO.TXT', 'x');
    fs.setAttr('RO.TXT', { R: true });
    let code = null;
    try { fs.unlink('RO.TXT'); } catch (e) { code = e.code; }
    eq(code, 'ACCESS_DENIED');
    code = null;
    try { fs.writeText('A:\\BIG.TXT', 'x'.repeat(1500000)); } catch (e) { code = e.code; }
    eq(code, 'DISK_FULL');
  });

  // ==================================================================
  // 内置命令（正常路径与错误路径）
  // ==================================================================

  test('Commands: unknown command and empty input', async () => {
    const m = mk();
    includes(await run(m, 'FOOBAR'), 'Bad command or file name');
    includes(await run(m, 'README.TXT'), 'Bad command or file name');
    eq(await run(m, '   '), '');
  });

  test('Commands: DIR with wildcards, /W, /B, /A, /S and errors', async () => {
    const m = mk();
    const out = await run(m, 'DIR *.TXT');
    includes(out, 'README   TXT');
    notIncludes(out, 'AUTOEXEC');
    includes(await run(m, 'DIR /W'), '[GAMES]');
    eq(await run(m, 'DIR C:\\GAMES\\*.COM /B'), 'PLASMA.COM\nBALL.COM');
    includes(await run(m, 'DIR /A'), 'IO       SYS');
    notIncludes(await run(m, 'DIR'), 'IO       SYS');
    includes(await run(m, 'DIR /S /B *.BAT'), 'C:\\UTILS\\DEMO.BAT');
    includes(await run(m, 'DIR *.XYZ'), 'File not found');
    includes(await run(m, 'DIR Q:'), 'Invalid drive specification');
  });

  test('Commands: DIR /P pauses per screen', async () => {
    const m = mk();
    for (let i = 0; i < 30; i++) m.fs.writeText(`C:\\TEMP\\F${i}.TXT`, 'x');
    const out = await run(m, 'DIR C:\\TEMP /P', ' ');
    includes(out, '(continuing C:\\TEMP)');
    includes(out, '30 file(s)');
  });

  test('Commands: CD at root, invalid path, CD drive', async () => {
    const m = mk();
    await run(m, 'CD ..');
    eq(m.fs.getCwd(), 'C:\\');
    includes(await run(m, 'CD NOWHERE'), 'Invalid directory');
    await run(m, 'CD \\MARIO');
    eq(m.fs.getCwd(), 'C:\\MARIO');
    includes(await run(m, 'CD'), 'C:\\MARIO');
    includes(await run(m, 'CD A:'), 'A:\\');
  });

  test('Commands: MD/RD including /S and errors', async () => {
    const m = mk();
    await run(m, 'MD NEWDIR');
    assert(m.fs.isDir('NEWDIR'));
    includes(await run(m, 'MD NEWDIR'), 'Unable to create directory');
    includes(await run(m, 'MD'), 'Required parameter missing');
    m.fs.writeText('NEWDIR\\A.TXT', 'a');
    includes(await run(m, 'RD NEWDIR'), 'directory not empty');
    await run(m, 'RD /S NEWDIR', 'Y');
    assert(!m.fs.exists('NEWDIR'));
  });

  test('Commands: COPY multiple files, /Y, overwrite prompt, COPY CON', async () => {
    const m = mk();
    let out = await run(m, 'COPY C:\\UTILS\\*.BAT A:');
    includes(out, '7 file(s) copied');
    eq(m.fs.list('A:\\').length, 7);
    out = await run(m, 'COPY C:\\UTILS\\HELLO.BAT A:', 'N');
    includes(out, 'Overwrite A:\\HELLO.BAT (Yes/No/All)?');
    includes(out, '0 file(s) copied');
    includes(await run(m, 'COPY C:\\UTILS\\HELLO.BAT A: /Y'), '1 file(s) copied');
    includes(await run(m, 'COPY NOPE.TXT A:'), 'File not found');
    includes(await run(m, 'COPY README.TXT README.TXT'), 'cannot be copied onto itself');
    await run(m, 'COPY CON NOTE.TXT', 'line one{Enter}line two{Enter}{F6}{Enter}');
    eq(m.fs.readText('NOTE.TXT'), 'line one\nline two\n');
    await run(m, 'COPY README.TXT+NOTE.TXT BOTH.TXT');
    eq(m.fs.readText('BOTH.TXT'), m.fs.readText('README.TXT') + 'line one\nline two\n');
  });

  test('Commands: DEL batch delete, confirmation, read-only', async () => {
    const m = mk();
    for (const n of ['A1.TMP', 'A2.TMP', 'B1.TMP']) m.fs.writeText(n, n);
    await run(m, 'DEL A?.TMP');
    assert(!m.fs.exists('A1.TMP') && !m.fs.exists('A2.TMP') && m.fs.exists('B1.TMP'));
    includes(await run(m, 'DEL NOPE.TMP'), 'File not found');
    m.fs.writeText('A:\\X.TXT', '1'); m.fs.writeText('A:\\Y.TXT', '2');
    let out = await run(m, 'DEL A:\\*.*', 'N');
    includes(out, 'All files in directory will be deleted!');
    eq(m.fs.list('A:\\').length, 2);
    await run(m, 'ERASE A:\\*.*', 'Y');
    eq(m.fs.list('A:\\').length, 0);
    await run(m, 'ATTRIB +R B1.TMP');
    includes(await run(m, 'DEL B1.TMP'), 'Access denied');
  });

  test('Commands: REN with wildcards, MOVE, TYPE, ATTRIB, TREE, FC', async () => {
    const m = mk();
    m.fs.writeText('ONE.TXT', 'alpha\nbeta\ngamma\n');
    m.fs.writeText('TWO.TXT', 'alpha\nBETA\ngamma\n');
    await run(m, 'REN *.TXT *.DOC');
    assert(m.fs.exists('ONE.DOC') && m.fs.exists('README.DOC'));
    includes(await run(m, 'REN NOPE.X Y.X'), 'Duplicate file name or file not found');
    includes(await run(m, 'MOVE ONE.DOC TEMP'), 'C:\\ONE.DOC => C:\\TEMP\\ONE.DOC [ok]');
    includes(await run(m, 'TYPE TEMP\\ONE.DOC'), 'beta');
    includes(await run(m, 'ATTRIB TEMP\\ONE.DOC'), 'C:\\TEMP\\ONE.DOC');
    includes(await run(m, 'TREE'), '├───GAMES');
    includes(await run(m, 'TREE /A'), '+---GAMES');
    const fc = await run(m, 'FC TEMP\\ONE.DOC TWO.DOC');
    includes(fc, '***** C:\\TEMP\\ONE.DOC');
    includes(fc, 'BETA');
    eq(m.errorLevel, 1);
    includes(await run(m, 'FC /C TEMP\\ONE.DOC TWO.DOC'), 'no differences encountered');
    includes(await run(m, 'FC A.TXT'), 'Insufficient');
  });

  test('Commands: ECHO, SET, PATH, PROMPT, VER, VOL, MEM, CHKDSK, HELP, /?', async () => {
    const m = mk();
    eq(await run(m, 'ECHO hello  world'), 'hello  world');
    eq(await run(m, 'ECHO'), 'ECHO is on');
    await run(m, 'SET GREETING=Hi there');
    eq(await run(m, 'ECHO %GREETING%!'), 'Hi there!');
    await run(m, 'SET GREETING=');
    eq(m.getEnv('GREETING'), undefined);
    await run(m, 'PATH ;');
    includes(await run(m, 'PATH'), 'No Path');
    await run(m, 'PROMPT $N$G');
    eq(m.promptString(), 'C>');
    includes(await run(m, 'VER'), 'MS-DOS Version 6.22');
    includes(await run(m, 'VOL'), 'Volume Serial Number is 1A2B-3C4D');
    includes(await run(m, 'MEM'), 'Largest executable program size');
    includes(await run(m, 'CHKDSK'), 'bytes total disk space');
    includes(await run(m, 'HELP', '      '), 'DIR');
    includes(await run(m, 'HELP COPY'), 'COPY [/Y|/-Y]');
    includes(await run(m, 'DIR /?'), 'Displays a list of files');
    includes(await run(m, 'MARIO /?'), 'Z or Space');
    // 每个命令都有帮助
    for (const def of DOS.Commands.list()) assert(m.helpText(def) && def.summary, def.name + ' has help');
  });

  test('Commands: DATE/TIME use the real clock and accept new values', async () => {
    const m = mk();
    const now = new Date();
    includes(await run(m, 'DATE /T'), String(now.getFullYear()));
    await run(m, 'DATE', '01-02-2030{Enter}');
    eq(m.now().getFullYear(), 2030);
    eq(m.now().getMonth(), 0);
    includes(await run(m, 'DATE', 'bad{Enter}{Enter}'), 'Invalid date');
    await run(m, 'TIME 13:45');
    eq(m.now().getHours(), 13);
  });

  test('Commands: redirection, pipes, MORE, SORT, FIND', async () => {
    const m = mk();
    await run(m, 'ECHO zebra > LIST.TXT');
    await run(m, 'ECHO apple >> LIST.TXT');
    eq(m.fs.readText('LIST.TXT'), 'zebra\napple\n');
    eq(await run(m, 'SORT < LIST.TXT'), 'apple\nzebra');
    eq(await run(m, 'TYPE LIST.TXT | FIND "app"'), 'apple');
    eq(await run(m, 'TYPE LIST.TXT | FIND /C "e"'), '2');
    await run(m, 'DIR /B C:\\UTILS > UT.TXT');
    includes(m.fs.readText('UT.TXT'), 'DEMO.BAT');
  });

  test('Commands: FORMAT clears a drive (and /S restores system files)', async () => {
    const m = mk();
    m.fs.writeText('A:\\X.TXT', 'x');
    await run(m, 'FORMAT A: /Q /V:FLOPPY', '{Enter}N');
    eq(m.fs.list('A:\\').length, 0);
    eq(m.fs.drives.A.label, 'FLOPPY');
    await run(m, 'FORMAT C: /Q /S /V:NEW', 'Y');
    eq(m.fs.list('C:\\').map(e => e.name).sort(), ['COMMAND.COM', 'IO.SYS', 'MSDOS.SYS']);
  });

  test('Commands: MODE 13 / MODE 3 switch video modes', async () => {
    const m = mk();
    await run(m, 'MODE 13');
    eq(m.display, 'gfxconsole');
    eq([m.term.cols, m.gfx.width, m.gfx.height], [40, 320, 200]);
    await run(m, 'MODE 3');
    eq(m.display, 'text');
    eq(m.term.cols, 80);
    includes(await run(m, 'MODE 99'), 'Invalid parameter');
  });

  // ==================================================================
  // 行编辑与历史
  // ==================================================================

  async function readLineWith(m, keys) {
    m.input.feed(keys);
    return m.input.readLine();
  }

  test('Input: editing keys, insert/overwrite, Esc', async () => {
    const m = mk();
    eq(await readLineWith(m, 'abc{ArrowLeft}{Backspace}{Enter}'), 'ac');
    eq(await readLineWith(m, 'hello{Home}{Delete}J{Enter}'), 'Jello');
    eq(await readLineWith(m, 'abcd{Home}{Insert}XY{Insert}{End}!{Enter}'), 'XYcd!');
    eq(await readLineWith(m, 'garbage{Escape}ok{Enter}'), 'ok');
    eq(await readLineWith(m, '{Backspace}{Backspace}{Backspace}x{Enter}'), 'x', 'backspace on empty line');
  });

  test('Input: history (Up/Down), F1, F3, 50+ entries', async () => {
    const m = mk();
    for (let i = 0; i < 60; i++) await readLineWith(m, `cmd${i}{Enter}`);
    assert(m.input.history.length >= 50, 'history keeps at least 50 commands');
    eq(await readLineWith(m, '{ArrowUp}{ArrowUp}{Enter}'), 'cmd58');
    eq(await readLineWith(m, '{ArrowUp}{ArrowUp}{ArrowDown}{Enter}'), 'cmd58');
    await readLineWith(m, 'DIR /W{Enter}');
    eq(await readLineWith(m, '{F1}{F1}{F1}{Enter}'), 'DIR');
    eq(await readLineWith(m, '{F3}{Enter}'), 'DIR');
    eq(await readLineWith(m, 'X{F3}{Enter}'), 'XIR');
  });

  test('Input: Tab completion cycles commands and file names', async () => {
    const m = mk();
    eq(await readLineWith(m, 'TY{Tab}{Enter}'), 'TYPE');
    eq(await readLineWith(m, 'type REA{Tab}{Enter}'), 'type README.TXT');
    eq(await readLineWith(m, 'dir GAMES\\B{Tab}{Enter}'), 'dir GAMES\\BALL.COM');
    const first = await readLineWith(m, 'C{Tab}{Enter}');
    const second = await readLineWith(m, 'C{Tab}{Tab}{Enter}');
    assert(first !== second && first.startsWith('C') && second.startsWith('C'), `cycled ${first} -> ${second}`);
    eq(await readLineWith(m, 'MAR{Tab}{Enter}'), 'MARIO');
  });

  test('Input: overlong command is capped at 127 characters', async () => {
    const m = mk();
    const line = await readLineWith(m, 'x'.repeat(200) + '{Enter}');
    eq(line.length, 127);
  });

  test('Input: Ctrl+C cancels the line', async () => {
    const m = mk();
    eq(await readLineWith(m, 'abc{Ctrl+C}'), null);
    includes(m.term.screenText(), 'abc^C');
  });

  // ==================================================================
  // 批处理解释器
  // ==================================================================

  test('Batch: IF / GOTO / FOR / CALL / SHIFT / %VAR%', async () => {
    const m = mk();
    m.fs.writeText('T.BAT', [
      '@ECHO OFF',
      'SET V=one',
      'IF "%1"=="go" GOTO skip',
      'ECHO not skipped',
      ':skip',
      'ECHO arg=%1 var=%V%',
      'FOR %%X IN (a b c) DO ECHO item %%X',
      'FOR %%F IN (C:\\GAMES\\*.COM) DO ECHO file %%F',
      'CALL SUB.BAT inner',
      'ECHO after call',
      'SHIFT',
      'ECHO shifted=%1',
      'IF NOT EXIST NOPE.TXT ECHO nope missing',
      'IF EXIST T.BAT ECHO self exists'
    ].join('\n'));
    m.fs.writeText('SUB.BAT', '@ECHO in sub %1\n');
    const out = await run(m, 'T go second');
    notIncludes(out, 'not skipped');
    includes(out, 'arg=go var=one');
    includes(out, 'item a\nitem b\nitem c');
    includes(out, 'file C:\\GAMES\\PLASMA.COM');
    includes(out, 'in sub inner\nafter call');
    includes(out, 'shifted=second');
    includes(out, 'nope missing\nself exists');
  });

  test('Batch: ECHO ON echoes commands; chaining without CALL does not return', async () => {
    const m = mk();
    m.fs.writeText('E.BAT', 'ECHO visible\nCHAIN.BAT\nECHO never printed\n');
    m.fs.writeText('CHAIN.BAT', '@ECHO chained\n');
    const out = await run(m, 'E');
    includes(out, 'C:\\>ECHO visible');
    includes(out, 'chained');
    notIncludes(out, 'never printed');
    assert(m.echo, 'echo restored after batch');
  });

  test('Batch: CHOICE sets ERRORLEVEL, IF ERRORLEVEL branches', async () => {
    const m = mk();
    m.fs.writeText('C.BAT', '@ECHO OFF\nCHOICE /C:ABC Pick\nIF ERRORLEVEL 3 GOTO c\nIF ERRORLEVEL 2 GOTO b\nECHO got A\nGOTO end\n:b\nECHO got B\nGOTO end\n:c\nECHO got C\n:end\n');
    includes(await run(m, 'C', 'b'), 'got B');
    eq(m.errorLevel, 2);
    includes(await run(m, 'C', 'x c'), 'got C');
    const t = await run(m, 'CHOICE /C:YN /T:N,1 Wait');
    includes(t, 'Wait [Y,N]?N');
    eq(m.errorLevel, 2);
  });

  test('Batch: missing label and :: comments', async () => {
    const m = mk();
    m.fs.writeText('L.BAT', '@ECHO OFF\n:: comment\nREM another\nGOTO nowhere\nECHO unreachable\n');
    const out = await run(m, 'L');
    includes(out, 'Label not found');
    notIncludes(out, 'unreachable');
    notIncludes(out, 'comment');
  });

  test('Batch: Ctrl+C asks "Terminate batch job (Y/N)?" and stops an endless loop', async () => {
    const m = mk();
    m.term.clear();
    const p = m.runInteractive('C:\\UTILS\\FOREVER.BAT');
    await sleep(30);
    m.input.feed('{Ctrl+C}');
    await sleep(20);
    m.input.feed('Y');
    await p;
    const out = m.term.allText();
    includes(out, 'Still running...');
    includes(out, 'Terminate batch job (Y/N)? Y');
    eq(m.batchStack.length, 0);
  });

  test('Batch: answering N continues the batch', async () => {
    const m = mk();
    m.fs.writeText('P.BAT', '@ECHO OFF\nPAUSE\nECHO continued\n');
    m.term.clear();
    const p = m.runInteractive('P');
    await sleep(10);
    m.input.feed('{Ctrl+C}');
    await sleep(10);
    m.input.feed('N');
    await p;
    includes(m.term.allText(), 'Terminate batch job (Y/N)? N');
    includes(m.term.allText(), 'continued');
  });

  // ==================================================================
  // Graphics
  // ==================================================================

  test('Graphics: primitives, clipping, blit transparency, double buffer', () => {
    const g = new DOS.Graphics();
    g.clear(0);
    g.line(0, 0, 10, 5, 4);
    eq([g.pget(0, 0), g.pget(10, 5)], [4, 4]);
    g.fillRect(-5, -5, 10, 10, 7);
    eq([g.pget(0, 0), g.pget(4, 4), g.pget(5, 5)], [7, 7, 0]);
    g.rect(20, 20, 5, 5, 9);
    eq([g.pget(20, 20), g.pget(24, 24), g.pget(22, 22)], [9, 9, 0]);
    g.circle(100, 100, 10, 12);
    eq([g.pget(110, 100), g.pget(90, 100), g.pget(100, 110), g.pget(100, 100)], [12, 12, 12, 0]);
    g.fillCircle(200, 100, 5, 13);
    eq(g.pget(200, 100), 13);
    g.pset(400, 400, 1); // 越界被裁剪，不抛异常
    g.clear(2);
    g.blit({ w: 2, h: 1, data: new Uint8Array([0, 5]) }, 50, 50);
    eq([g.pget(50, 50), g.pget(51, 50)], [2, 5], 'colour 0 is transparent');
    eq(g.front[0], 0, 'front buffer untouched before swap');
    g.swap();
    eq(g.front[0], 2);
    g.setPalette(5, 1, 2, 3);
    eq(g.getPalette(5), [1, 2, 3]);
    g.text('A', 0, 0, 15);
    assert(g.back.slice(0, 8).some(v => v === 15), 'text drawn with 8x8 font');
  });

  test('Programs: PLASMA and BALL run in mode 13h and Esc restores the text screen', async () => {
    for (const name of ['PLASMA', 'BALL']) {
      const m = mk();
      m.term.write('BEFORE-' + name);
      const p = m.runInteractive(name);
      await sleep(5);
      eq(m.display, 'gfx');
      eq([m.gfx.width, m.gfx.height], [320, 200]);
      await sleep(60);
      m.input.push({ key: 'Escape', code: 'Escape', char: '' });
      await p;
      eq(m.display, 'text');
      eq(m.input.mode, 'shell');
      includes(m.term.screenText(), 'BEFORE-' + name, 'screen restored');
    }
  });

  test('Programs: graphics program started from MODE 13 returns to 80x25 text', async () => {
    const m = mk();
    await run(m, 'MODE 13');
    const p = m.runInteractive('BALL');
    await sleep(40);
    m.input.push({ key: 'Escape', code: 'Escape', char: '' });
    await p;
    eq([m.display, m.term.cols], ['text', 80]);
  });

  // ==================================================================
  // MarioGame 物理与玩法
  // ==================================================================

  /** 测试关卡：平地，可选坑、方块、敌人 */
  function flatLevel(extra = {}) {
    return {
      name: 'T', time: 400, start: extra.start || { x: 40, bottom: 208 },
      areas: {
        main: Object.assign({ width: 40, theme: 'overworld', ground: [[0, 39]], pipes: [], blocks: [], stairs: [], enemies: [] }, extra.main || {})
      }
    };
  }

  function newGame(extra) { return new DOS.MarioGame({ level: flatLevel(extra), autoStart: true }); }

  /** 返回本次跳跃中马里奥脚底的最小 y（最高点） */
  function jumpApex(game, holdFrames, input = {}) {
    const startBottom = game.mario.y + game.mario.h;
    let apex = startBottom;
    for (let f = 0; f < 120; f++) {
      game.step(Object.assign({ a: f < holdFrames }, input));
      apex = Math.min(apex, game.mario.y + game.mario.h);
      if (f > 2 && game.mario.onGround) break;
    }
    return startBottom - apex;
  }

  test('Mario: short jump vs long jump (holding A) heights differ', () => {
    const short = jumpApex(newGame(), 1);
    const long = jumpApex(newGame(), 60);
    assert(short > 8 && short < 32, `short jump ${short.toFixed(1)}px`);
    assert(long >= 60 && long <= 80, `long jump ${long.toFixed(1)}px`);
    assert(long - short >= 32, `difference ${(long - short).toFixed(1)}px`);
  });

  test('Mario: running (B) is faster than walking and running jumps are higher', () => {
    const g1 = newGame(), g2 = newGame();
    for (let i = 0; i < 90; i++) { g1.step({ right: true }); g2.step({ right: true, b: true }); }
    assert(Math.abs(g1.mario.vx - DOS.MarioData.PHYSICS.maxWalk) < 1e-6, 'walk speed capped at max walk');
    assert(Math.abs(g2.mario.vx - DOS.MarioData.PHYSICS.maxRun) < 1e-6, 'run speed capped at max run');
    const runJump = jumpApex(g2, 60, { right: true, b: true });
    const standJump = jumpApex(newGame(), 60);
    assert(runJump > standJump, `running jump ${runJump} > standing jump ${standJump}`);
  });

  test('Mario: turning around skids (decelerates) before reversing', () => {
    const g = newGame();
    for (let i = 0; i < 60; i++) g.step({ right: true, b: true });
    g.step({ left: true });
    assert(g.mario.skid, 'skid flag set');
    assert(g.mario.vx > 0, 'still moving right while skidding');
    let frames = 0;
    while (g.mario.vx > 0 && frames < 60) { g.step({ left: true }); frames++; }
    assert(frames > 10, `skid lasted ${frames} frames`);
  });

  test('Mario: horizontal then vertical collision, no wall clipping', () => {
    const g = newGame({ main: { stairs: [[6, 3]] } });
    for (let i = 0; i < 120; i++) g.step({ right: true, b: true });
    assert(g.mario.x + g.mario.w <= 6 * 16, 'stopped by the wall');
    eq(g.mario.onGround, true);
  });

  test('Mario: stomping a Goomba squashes it and bounces Mario', () => {
    const g = newGame({ main: { enemies: [['goomba', 4, 12]] } });
    const m = g.mario;
    m.x = 64; m.y = 140; m.vy = 2;
    g.enemies[0].vx = 0;
    let stomped = false;
    for (let i = 0; i < 40 && !stomped; i++) {
      g.step({});
      if (g.enemies[0] && g.enemies[0].state === 'flat') stomped = true;
    }
    assert(stomped, 'goomba flattened');
    assert(m.vy < 0, 'mario bounced upward');
    eq(g.score, 100);
    eq(g.state, 'play');
  });

  test('Mario: Koopa becomes a shell, shell can be kicked', () => {
    const g = newGame({ main: { enemies: [['koopa', 4, 12]] } });
    const m = g.mario;
    m.x = 64; m.y = 140; m.vy = 2;
    g.enemies[0].vx = 0;
    for (let i = 0; i < 40 && g.enemies[0].state === 'walk'; i++) g.step({});
    eq(g.enemies[0].state, 'shell');
    for (let i = 0; i < 60 && m.vy !== 0; i++) g.step({});
    // 侧面接触静止龟壳 → 踢出
    m.x = g.enemies[0].x - m.w - 1; m.y = 208 - m.h;
    for (let i = 0; i < 10 && g.enemies[0].state === 'shell'; i++) g.step({ right: true });
    eq(g.enemies[0].state, 'shellMove');
    assert(Math.abs(g.enemies[0].vx) === DOS.MarioData.PHYSICS.shellSpeed);
    eq(g.state, 'play', 'kicking does not hurt');
  });

  test('Mario: side collision with a Goomba kills small Mario', () => {
    const g = newGame({ main: { enemies: [['goomba', 6, 12]] } });
    for (let i = 0; i < 120 && g.state === 'play'; i++) g.step({ right: true });
    eq(g.state, 'dying');
    const lives = g.lives;
    for (let i = 0; i < 260; i++) g.step({});
    eq(g.lives, lives - 1, 'life lost');
    assert(g.state === 'intro' || g.state === 'play', 'level restarts');
  });

  test('Mario: falling into a pit kills Mario; GAME OVER at 0 lives', () => {
    const g = new DOS.MarioGame({ level: flatLevel({ main: { ground: [[0, 3], [8, 39]] } }), autoStart: true, lives: 1 });
    for (let i = 0; i < 200 && g.state === 'play'; i++) g.step({ right: true });
    eq(g.state, 'dying');
    assert(g.mario.pit, 'pit death');
    for (let i = 0; i < 260; i++) g.step({});
    eq(g.lives, 0);
    eq(g.state, 'gameover');
  });

  test('Mario: ? block mushroom makes Mario big; getting hit shrinks him with invincibility', () => {
    const g = newGame({ main: { blocks: [[3, 9, '?', 'mushroom']] } });
    const m = g.mario;
    m.x = 3 * 16 + 2;
    for (let i = 0; i < 40; i++) g.step({ a: true });
    eq(g.area.get(3, 9), DOS.MarioTiles.USED, 'block used');
    eq(g.items.length, 1);
    eq(g.items[0].kind, 'mushroom');
    // 马里奥站到右边，等蘑菇升起、向右滑下方块后撞上他
    m.x = 9 * 16;
    let grown = false;
    for (let i = 0; i < 600 && !grown; i++) { g.step({}); if (m.big) grown = true; }
    assert(grown, 'mario grew');
    eq(m.h, 31);
    eq(g.score, 1000);
    eq(m.y + m.h, 208, 'grown mario still stands on the ground');
    // 敌人侧撞：变小并短暂无敌（不死）
    g.enemies = [{ kind: 'goomba', x: m.x + m.w + 2, y: 192, w: 16, h: 16, vx: -0.5, vy: 0, state: 'walk', timer: 0, grace: 0 }];
    for (let i = 0; i < 100 && (m.big || g.state === 'transform'); i++) g.step({});
    eq(m.big, false);
    eq(m.h, 15);
    assert(m.invuln > 0, 'temporarily invincible');
    eq(g.state, 'play', 'still alive');
    for (let i = 0; i < 30; i++) g.step({});
    eq(g.state, 'play', 'invincibility protects from the same goomba');
  });

  test('Mario: bricks bump when small, break when big', () => {
    const g = newGame({ main: { blocks: [[3, 9, 'B'], [6, 9, 'B']] } });
    const m = g.mario;
    m.x = 3 * 16 + 2;
    for (let i = 0; i < 40; i++) g.step({ a: true });
    eq(g.area.get(3, 9), DOS.MarioTiles.BRICK, 'small mario only bumps');
    for (let i = 0; i < 60; i++) g.step({});
    m.big = true; m.y -= 16; m.h = 31; m.x = 6 * 16 + 2;
    for (let i = 0; i < 40; i++) g.step({ a: true });
    eq(g.area.get(6, 9), DOS.MarioTiles.EMPTY, 'big mario breaks bricks');
    eq(g.score, 50);
  });

  test('Mario: TIME running out kills Mario', () => {
    const g = newGame();
    g.time = 1;
    for (let i = 0; i < 30 && g.state === 'play'; i++) g.step({});
    eq(g.state, 'dying');
  });

  test('Mario: Enter pauses the game', () => {
    const g = newGame();
    g.step({ start: true });
    assert(g.paused);
    const x = g.mario.x;
    for (let i = 0; i < 10; i++) g.step({ right: true });
    eq(g.mario.x, x, 'no movement while paused');
    g.step({ start: false });
    g.step({ start: true });
    assert(!g.paused);
  });

  test('Mario: level 1-1 data matches the classic layout', () => {
    const L = DOS.MarioData.LEVEL.areas.main;
    eq(L.width, 212);
    eq(L.ground, [[0, 68], [71, 85], [89, 152], [155, 211]], 'pits at 69-70, 86-88, 153-154');
    eq(L.flag.x, 198);
    const g = new DOS.MarioGame({ autoStart: true });
    eq(g.area.get(64, 8), DOS.MarioTiles.HIDDEN, 'hidden 1UP block');
    eq(g.area.contents.get('64,8'), '1up');
    eq(g.area.get(21, 9), DOS.MarioTiles.QUESTION);
    eq(g.area.contents.get('21,9'), 'mushroom');
    eq(L.pipes.length, 6);
    assert(L.enemies.some(e => e[0] === 'koopa'), 'has a Koopa');
    eq(L.stairs.filter(s => s[0] >= 181).length, 9, 'final staircase');
  });

  /** 简单的自动驾驶：一直向右走，遇到墙/坑/敌人就跳（长按 A 跳满） */
  function autoPlay(game, maxFrames) {
    let hold = 0, prevA = false;
    // 每丢一条命就换一种起跳提前量（像玩家一样调整节奏）
    const factors = [15, 12, 20, 24, 27, 30, 14, 21, 18];
    const solid = (tx, ty) => game._solid(tx, ty);
    for (let f = 0; f < maxFrames; f++) {
      if (game.state === 'clear') return f;
      const m = game.mario;
      const inp = { right: true };
      if (game.state === 'title') inp.start = f % 2 === 0;
      if (game.state === 'play') {
        let need = false;
        const front = m.x + m.w;
        for (let dx = 1; dx <= 24 && !need; dx += 3) {
          const tx = Math.floor((front + dx) / 16);
          for (let ty = Math.floor(m.y / 16); ty <= Math.floor((m.y + m.h - 1) / 16); ty++) if (solid(tx, ty)) need = true;
        }
        const feet = Math.floor((m.y + m.h) / 16);
        if (!solid(Math.floor((front + 10) / 16), feet)) need = true;
        const k = factors[(game.startLives - game.lives) % factors.length];
        for (const e of game.enemies) {
          if ((e.state === 'walk' || e.state === 'shellMove') && e.x + e.w > m.x && e.x - front < 24 + Math.abs(m.vx) * k && Math.abs(e.y + e.h - (m.y + m.h)) < 20) need = true;
        }
        if (m.onGround) {
          if (need && !prevA) { inp.a = true; hold = 45; }
        } else if (hold > 0) { inp.a = true; hold--; }
      }
      game.step(inp);
      prevA = !!inp.a;
    }
    return -1;
  }

  test('Mario: an automated run completes World 1-1 and shows COURSE CLEAR', () => {
    const g = new DOS.MarioGame({ lives: 9 });
    const events = [];
    const frames = autoPlay(g, 60 * 60 * 6);
    for (const e of g.events) events.push(e.type + ':' + e.name);
    assert(frames > 0, `level not cleared (state=${g.state}, x=${Math.round(g.mario.x)}, lives=${g.lives})`);
    eq(g.state, 'clear');
    assert(g.score > 0, 'score awarded');
    assert(events.includes('sfx:flagpole'), 'flagpole sound');
    assert(events.some(e => e.startsWith('announce:Course clear')), 'course clear announced');
  });

  test('Mario: warp pipe leads to the bonus room and back out', () => {
    const g = new DOS.MarioGame({ autoStart: true });
    const m = g.mario;
    g.camX = 57 * 16 - 100;
    m.x = 57 * 16 + 10; m.y = 9 * 16 - m.h; m.vy = 0; m.onGround = true;
    for (let i = 0; i < 2; i++) g.step({});
    for (let i = 0; i < 60 && g.area.id === 'main'; i++) g.step({ down: true });
    eq(g.area.id, 'bonus');
    for (let i = 0; i < 400 && g.area.id === 'bonus'; i++) g.step({ right: true });
    eq(g.area.id, 'main');
    for (let i = 0; i < 80 && g.state !== 'play'; i++) g.step({});
    assert(Math.abs(g.mario.x - 163 * 16) < 32, 'exits from pipe at x=163');
    assert(g.coins > 0, 'collected bonus coins on the way');
  });

  root.HTMLDOS_TESTS_LOADED = true;
})(typeof globalThis !== 'undefined' ? globalThis : this);
