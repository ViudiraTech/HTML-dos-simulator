/*
 * DiskImage —— 出厂磁盘内容（C: 初始文件、示例批处理、程序存根）
 * ---------------------------------------------------------------
 * .COM 文件是带签名 "HTMLDOS:<ID>" 的二进制存根，执行时由 Machine 读取签名，
 * 再交给 Programs 注册表中对应的 JS 实现。因此把 MARIO.COM 复制到 A: 也能运行。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const SIGNATURE = 'HTMLDOS:';

  /**
   * 生成程序存根字节：JMP + 签名 + CR LF ^Z（TYPE 遇 ^Z 停止）+ 伪随机填充。
   * @param {string} id 程序 ID（Programs 注册表键）
   * @param {number} size 文件大小（字节）
   * @returns {Uint8Array}
   */
  function programBytes(id, size) {
    const head = [0xE9, 0x40, 0x00];
    const sig = SIGNATURE + id;
    const bytes = new Uint8Array(Math.max(size, sig.length + 16));
    bytes.set(head, 0);
    for (let i = 0; i < sig.length; i++) bytes[3 + i] = sig.charCodeAt(i);
    let p = 3 + sig.length;
    bytes[p++] = 0; bytes[p++] = 0x0D; bytes[p++] = 0x0A; bytes[p++] = 0x1A;
    let seed = 0x1234 ^ id.length * 977;
    for (; p < bytes.length - 2; p++) { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; bytes[p] = (seed >> 16) & 0xFF; }
    bytes[bytes.length - 2] = 0xCD; bytes[bytes.length - 1] = 0x20; // INT 20h
    return bytes;
  }

  /** 从文件字节中提取程序 ID @returns {string|null} */
  function programId(bytes) {
    let s = '';
    for (let i = 0; i < Math.min(bytes.length, 64); i++) s += String.fromCharCode(bytes[i]);
    const i = s.indexOf(SIGNATURE);
    if (i < 0) return null;
    const m = /^[A-Z0-9_]+/.exec(s.slice(i + SIGNATURE.length));
    return m ? m[0] : null;
  }

  function prog(id, size, mtime, attr) {
    return { b64: DOS.FileSystem.base64.encode(programBytes(id, size)), mtime, attr };
  }

  const T = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
  const DOS_DATE = T(1994, 5, 31, 6, 22);
  const SHIP_DATE = T(2026, 10, 20, 12, 0);
  const txt = (text, mtime = SHIP_DATE, attr) => ({ text, mtime, attr });

  const AUTOEXEC = [
    '@ECHO OFF',
    'PROMPT $P$G',
    'PATH C:\\;C:\\UTILS;C:\\GAMES;C:\\MARIO',
    'SET TEMP=C:\\TEMP',
    'SET BLASTER=A220 I5 D1 T4',
    'ECHO.',
    'ECHO  HTML-DOS 6.22 simulator ready.',
    'ECHO  Type HELP for commands, F12 for keyboard shortcuts.',
    'ECHO  Try: DIR, TREE, PLASMA, BALL, MARIO, MENU or DEMO hello world',
    ''
  ].join('\n');

  const CONFIG = [
    'DOS=HIGH,UMB',
    'FILES=40',
    'BUFFERS=20',
    'LASTDRIVE=E',
    ''
  ].join('\n');

  const README = [
    'HTML-DOS 6.22 SIMULATOR',
    '=======================',
    '',
    'An MS-DOS style command line that runs entirely in your browser.',
    'Files are kept in localStorage, so they survive a page reload.',
    '',
    'Getting started',
    '  HELP            list all commands (HELP DIR for details, or DIR /?)',
    '  DIR /W          wide directory listing',
    '  TREE /F         show the directory tree',
    '  CD GAMES        change directory, CD .. goes up',
    '  MODE 13         switch to 320x200x256 graphics, MODE 3 to go back',
    '  PLASMA, BALL    graphics demos (Esc returns to the prompt)',
    '  MARIO           a 1-1 tribute platformer (MARIO /? for keys)',
    '  MENU            a CHOICE based menu written as a batch file',
    '  DEMO a b c      batch demo using IF, GOTO, FOR, CALL and CHOICE',
    '',
    'Editing keys',
    '  Left/Right/Home/End/Backspace/Delete edit the line, Insert toggles',
    '  insert/overwrite, Up/Down browse history, F1/F3 copy the previous',
    '  command, Tab completes file and command names, Esc clears the line,',
    '  Ctrl+C aborts, Shift+PgUp/PgDn scroll back, F12 shows all shortcuts.',
    '',
    'MARIO.COM is a non-commercial fan tribute with original pixel art and',
    'music. It is not affiliated with or endorsed by Nintendo.',
    ''
  ].join('\n');

  const MARIO_TXT = [
    'MARIO.COM - World 1-1 tribute',
    '',
    'Controls',
    '  Left / Right  (or A / D)     walk',
    '  Down          (or S)         crouch / enter pipe',
    '  Z or Space                   jump  (NES A button, hold to jump higher)',
    '  X or Shift                   run   (NES B button)',
    '  Enter                        start / pause',
    '  Esc                          quit to DOS',
    '',
    'Options',
    '  MARIO /M     sound effects only, no background music',
    '  MARIO /?     show this help',
    '',
    'Original pixel art and music; a fan tribute not affiliated with Nintendo.',
    ''
  ].join('\n');

  const BAT = {
    DEMO: [
      '@ECHO OFF',
      'REM DEMO.BAT - shows IF, GOTO, FOR, CALL, SHIFT and CHOICE',
      ':: lines starting with a double colon are comments too',
      'ECHO Running %0',
      'IF "%1"=="" GOTO noargs',
      'ECHO First argument: %1   All arguments: %*',
      'GOTO argsdone',
      ':noargs',
      'ECHO No arguments given. Try: DEMO hello world',
      ':argsdone',
      'FOR %%C IN (RED GREEN BLUE) DO ECHO Colour: %%C',
      'FOR %%F IN (C:\\*.BAT C:\\*.TXT) DO ECHO Found file %%F',
      'IF EXIST C:\\README.TXT ECHO README.TXT exists',
      'IF NOT EXIST C:\\NOPE.TXT ECHO NOPE.TXT does not exist',
      'CALL HELLO.BAT from-demo',
      'ECHO Back in DEMO.BAT',
      'CHOICE /C:YN /T:N,5 Continue the demo',
      'IF ERRORLEVEL 2 GOTO saidno',
      'ECHO You chose Yes.',
      'GOTO end',
      ':saidno',
      'ECHO You chose No (or the 5 second timeout expired).',
      ':end',
      'ECHO Demo finished.',
      ''
    ],
    HELLO: [
      '@ECHO OFF',
      'ECHO Hello from HELLO.BAT, called with "%1"',
      ''
    ],
    ARGS: [
      '@ECHO OFF',
      'ECHO %%0=%0 %%1=%1 %%2=%2 %%3=%3',
      ':next',
      'IF "%1"=="" GOTO done',
      'ECHO Argument: %1',
      'SHIFT',
      'GOTO next',
      ':done',
      ''
    ],
    COUNT: [
      '@ECHO OFF',
      'REM Counts by growing a string (batch files cannot do arithmetic)',
      'SET N=',
      ':loop',
      'SET N=%N%*',
      'ECHO %N%',
      'IF "%N%"=="**********" GOTO done',
      'GOTO loop',
      ':done',
      'SET N=',
      'ECHO Done counting.',
      ''
    ],
    FOREVER: [
      '@ECHO OFF',
      'ECHO Endless loop - press Ctrl+C, then Y to terminate.',
      ':top',
      'ECHO Still running...',
      'GOTO top',
      ''
    ],
    MENU: [
      '@ECHO OFF',
      ':menu',
      'ECHO.',
      'ECHO   1. Plasma demo',
      'ECHO   2. Bouncing balls',
      'ECHO   3. Mario 1-1',
      'ECHO   4. Quit',
      'CHOICE /C:1234 /N Select an option:',
      'IF ERRORLEVEL 4 GOTO end',
      'IF ERRORLEVEL 3 GOTO mario',
      'IF ERRORLEVEL 2 GOTO ball',
      'PLASMA',
      'GOTO menu',
      ':ball',
      'BALL',
      'GOTO menu',
      ':mario',
      'MARIO',
      'GOTO menu',
      ':end',
      'ECHO Bye.',
      ''
    ],
    GFX: [
      '@ECHO OFF',
      'REM Runs both graphics demos one after the other',
      'ECHO Press Esc to leave each demo.',
      'PAUSE',
      'PLASMA',
      'BALL',
      'ECHO Back in text mode.',
      ''
    ]
  };
  const bat = (name) => txt(BAT[name].join('\n'));

  /** 系统文件（FORMAT /S 时写入） */
  function systemFiles() {
    return {
      'IO.SYS': prog('IOSYS', 40774, DOS_DATE, 1 | 2 | 4),
      'MSDOS.SYS': prog('MSDOSSYS', 38138, DOS_DATE, 1 | 2 | 4),
      'COMMAND.COM': prog('COMMAND', 54645, DOS_DATE)
    };
  }

  /**
   * 构建出厂镜像。
   * @returns {{drives:object}}
   */
  function build() {
    const c = Object.assign(systemFiles(), {
      'CONFIG.SYS': txt(CONFIG, DOS_DATE),
      'AUTOEXEC.BAT': txt(AUTOEXEC),
      'README.TXT': txt(README),
      GAMES: {
        mtime: SHIP_DATE,
        dir: {
          'PLASMA.COM': prog('PLASMA', 1724, SHIP_DATE),
          'BALL.COM': prog('BALL', 2311, SHIP_DATE),
          'GAMES.TXT': txt('PLASMA.COM  - palette cycling plasma (Mode 13h)\nBALL.COM    - bouncing balls; arrows change gravity, Space adds a ball\n')
        }
      },
      UTILS: {
        mtime: SHIP_DATE,
        dir: {
          'DEMO.BAT': bat('DEMO'),
          'HELLO.BAT': bat('HELLO'),
          'ARGS.BAT': bat('ARGS'),
          'COUNT.BAT': bat('COUNT'),
          'FOREVER.BAT': bat('FOREVER'),
          'MENU.BAT': bat('MENU'),
          'GFX.BAT': bat('GFX')
        }
      },
      MARIO: {
        mtime: SHIP_DATE,
        dir: {
          'MARIO.COM': prog('MARIO', 40976, SHIP_DATE),
          'MARIO.TXT': txt(MARIO_TXT)
        }
      },
      TEMP: { mtime: SHIP_DATE, dir: {} }
    });
    return {
      drives: {
        A: { label: '', capacity: 1457664, removable: true, created: SHIP_DATE, files: {} },
        C: { label: 'MS-DOS_6', serial: '1A2B-3C4D', capacity: 536870912, created: DOS_DATE, files: c }
      }
    };
  }

  DOS.DiskImage = { build, systemFiles, programBytes, programId, SIGNATURE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
