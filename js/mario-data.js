/*
 * MarioData —— MARIO.COM 的全部数据：调色板、精灵、关卡 1-1、物理常数、音乐
 * ---------------------------------------------------------------
 * 说明：这是致敬性的原创实现，与任天堂无关联。所有像素图与音符均为本项目
 * 原创绘制/作曲，未使用任何 ROM 或受版权保护的素材；仅在风格与玩法上致敬
 * NES《超级马里奥兄弟》（1985）的 1-1 关卡。
 *
 * 精灵格式：字符串数组，每个字符是一个调色板键（'.' 为透明）。
 * 关卡格式：对象/数组描述，坐标单位为 16px 图块，行 0 在屏幕顶端，
 *           地面位于第 13–14 行（与 NES 的 15 行屏幕一致）。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  // ------------------------------------------------------------------
  // 调色板：键 → [MODE 13 调色板索引, 颜色]（接近 NES 配色）
  // ------------------------------------------------------------------
  const PALETTE = {
    '.': [0, '#000000'],   // 透明
    K: [16, '#000000'],    // 黑（描边）
    W: [17, '#FCFCFC'],    // 白
    S: [18, '#5C94FC'],    // 天空蓝
    R: [19, '#D82800'],    // 马里奥红
    U: [20, '#2038EC'],    // 背带裤蓝
    N: [21, '#883800'],    // 棕（头发、鞋）
    F: [22, '#FCA044'],    // 肤色
    Y: [23, '#F8B800'],    // 金黄（金币、问号块）
    O: [24, '#C84C0C'],    // 砖块棕
    P: [25, '#FCBCB0'],    // 浅粉（地面高光）
    D: [26, '#503000'],    // 深棕
    Q: [27, '#E45C10'],    // 问号橙
    G: [28, '#00A800'],    // 深绿（水管、龟壳）
    L: [29, '#B8F818'],    // 亮绿（高光）
    g: [30, '#80D010'],    // 中绿
    C: [31, '#3CBCFC'],    // 云影浅蓝
    T: [32, '#F0D0B0'],    // 浅褐（蘑菇柄、栗子脸）
    y: [33, '#FCE0A8'],    // 乌龟皮肤
    h: [34, '#005800'],    // 山丘深绿
    b: [35, '#0058F8'],    // 地下砖蓝
    c: [36, '#008888'],    // 地下地面青
    s: [37, '#A4E4FC'],    // 地下浅蓝高光
    z: [38, '#7C7C7C']     // 灰
  };

  // ------------------------------------------------------------------
  // 精灵（全部朝右绘制；朝左时水平翻转）
  // ------------------------------------------------------------------

  // 小马里奥上半身（0–7 行）
  const S_UP = [
    '................',
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....NNNFFKF.....',
    '...NFNFFFKFFF...',
    '...NFNNFFFFFFF..',
    '...NNFFFFKKKKK..',
    '.....FFFFFFF....'
  ];

  // 大马里奥上半身（0–15 行）
  const B_UP = [
    '......RRRRR.....',
    '.....RRRRRRRR...',
    '....RRRRRRRRRRR.',
    '....RRRRRRRRR...',
    '....NNNNFFKF....',
    '...NNFNFFFKFF...',
    '...NFNNFFFKFFFF.',
    '...NFNNFFFFFFFFF',
    '...NNFFFFFKKKKK.',
    '....NFFFFKKKKK..',
    '.....FFFFFFFF...',
    '......FFFFF.....',
    '....RRRURRRR....',
    '...RRRRURRRRR...',
    '..RRRRRUURRRRR..',
    '.RRRRRRUURRRRRR.'
  ];

  const SPRITES = {
    // ---------------- 小马里奥 16×16 ----------------
    smallStand: S_UP.concat([
      '....RRURRR......',
      '...RRRURRURRR...',
      '..RRRRUUUURRRR..',
      '..WWRUYUUYURWW..',
      '..WWWUUUUUUWWW..',
      '..WWUUUUUUUUWW..',
      '....UUU..UUU....',
      '...NNNN..NNNN...'
    ]),
    smallWalk1: S_UP.concat([
      '....RRURRR......',
      '..RRRRUURRRWW...',
      '.WWRRRUUUUWWW...',
      '.WW.RUYUUYU.....',
      '....UUUUUUUU....',
      '...UUUUU.UUUU...',
      '..NNUUU...UUNN..',
      '..NNN......NNN..'
    ]),
    smallWalk2: S_UP.concat([
      '....RRURRR......',
      '...RRRUURRR.....',
      '...RRUUUURWW....',
      '...WWUYUUYWW....',
      '...WWUUUUUU.....',
      '....UUUUUUU.....',
      '....NNUUUNN.....',
      '....NNN.NNN.....'
    ]),
    smallWalk3: S_UP.concat([
      '....RRURRR......',
      '...RRRUURRR.....',
      '...RRRUUUWW.....',
      '....RUYUYWW.....',
      '....UUUUUU......',
      '.....UUUUU......',
      '.....NNNUU......',
      '......NNNN......'
    ]),
    smallJump: [
      '..............WW',
      '.....RRRRR...WWW',
      '....RRRRRRRRRRR.',
      '....NNNFFKF.RRR.',
      '...NFNFFFKFFRRR.',
      '...NFNNFFFFFFRR.',
      '...NNFFFFKKKKR..',
      '.....FFFFFFFR...',
      '..RRRRRURRUR....',
      '.RRRRRRRUUUR....',
      'WWRRRRUUYUUU....',
      'WW..UUUUUUUUU...',
      '....UUUUUUUUUU..',
      '...UUUUUUUUUNN..',
      '..NNUUU....NNN..',
      '..NNN......NN...'
    ],
    smallSkid: [
      '................',
      '.....RRRRR......',
      '....RRRRRRRRR...',
      '....NNNFFKF.....',
      '...NFNFFFKFFF...',
      '...NFNNFFFFFFF..',
      '...NNFFFFKKKKK..',
      '..WW.FFFFFFF....',
      '.WWWRRRUR.......',
      '.WWRRRRUURR.....',
      '..RRRRUUUUU.....',
      '...RRUYUUYU.....',
      '....UUUUUUUU....',
      '....UUUUUUUUNN..',
      '...NNUUU..NNNN..',
      '...NNN.....NN...'
    ],
    smallDead: [
      '......RRRR......',
      '..WW.RRRRRR.WW..',
      '..WW.NFKKFN.WW..',
      '..FF.FFKKFF.FF..',
      '..FFNFFFFFFNFF..',
      '...FNKKKKKKNF...',
      '....FFFFFFFF....',
      '....RRRUURRR....',
      '...RRRRUURRRR...',
      '..RRRRUUUURRRR..',
      '..RRRUYUUYURRR..',
      '...UUUUUUUUUU...',
      '...UUUUUUUUUU...',
      '...UUUU..UUUU...',
      '..NNNN....NNNN..',
      '..NNNN....NNNN..'
    ],
    smallClimb: [
      '..........WW....',
      '.....RRRRRWW....',
      '....RRRRRRRR....',
      '....NNNFFKFRR...',
      '...NFNFFFKFRR...',
      '...NFNNFFFFRR...',
      '...NNFFFFKKRR...',
      '.....FFFFFRR....',
      '....RRURRRR.....',
      '...RRRUURRWW....',
      '...RRUUUUUWW....',
      '...UUYUUYUU.....',
      '...UUUUUUUU.....',
      '....UUUUUUNN....',
      '....NNN..NNN....',
      '....NNN.........'
    ],

    // ---------------- 大马里奥 16×32 ----------------
    bigStand: B_UP.concat([
      '.RRRRRUUUURRRRR.',
      '.WWRRUYUUYURRWW.',
      '.WWWUUUUUUUUWWW.',
      '.WWUUUUUUUUUUWW.',
      '...UUUUUUUUUU...',
      '...UUUUUUUUUU...',
      '...UUUUUUUUUU...',
      '...UUUUU.UUUUU..',
      '...UUUU...UUUU..',
      '...UUUU...UUUU..',
      '...UUUU...UUUU..',
      '...UUUU...UUUU..',
      '..NNNNN...NNNNN.',
      '.NNNNNN...NNNNNN',
      '.NNNNNN...NNNNNN',
      '................'
    ]),
    bigWalk1: B_UP.concat([
      'RRRRRRUUUURRRRWW',
      'WWRRRUYUUYUURWWW',
      'WWW.UUUUUUUUUWW.',
      'WW.UUUUUUUUUUU..',
      '...UUUUUUUUUUUU.',
      '..UUUUUU..UUUUU.',
      '..UUUUU....UUUU.',
      '.UUUUU......UUUU',
      '.UUUU.......UUUU',
      'UUUU........UUUU',
      'NNN..........NNN',
      'NNNN.........NNN',
      'NNNNN........NNN',
      '.NNNN.......NNNN',
      '............NNN.',
      '................'
    ]),
    bigWalk2: B_UP.concat([
      '.RRRRRUUUURRR...',
      '..RRRUYUUYURWW..',
      '...UUUUUUUUWWW..',
      '...UUUUUUUUUWW..',
      '...UUUUUUUUUU...',
      '...UUUUUUUUUU...',
      '....UUUU.UUUU...',
      '....UUUU.UUUU...',
      '....UUU..UUUU...',
      '....UUU...UUU...',
      '....UUU...UUU...',
      '...NNNN...NNNN..',
      '...NNNNN..NNNNN.',
      '...NNNNN..NNNNN.',
      '...NNNN....NNNN.',
      '................'
    ]),
    bigWalk3: B_UP.concat([
      '..RRRRUUUURRR...',
      '...RRUYUUYURR...',
      '....UUUUUUWWW...',
      '....UUUUUUWWW...',
      '....UUUUUUWW....',
      '.....UUUUUU.....',
      '.....UUUUUU.....',
      '.....UUUUU......',
      '......UUUU......',
      '......UUUU......',
      '......UUUU......',
      '......UUUU......',
      '.....NNNNN......',
      '.....NNNNNN.....',
      '.....NNNNNN.....',
      '................'
    ]),
    bigJump: [
      '..............WW',
      '......RRRRR..WWW',
      '.....RRRRRRRRWWW',
      '....RRRRRRRRRRR.',
      '....RRRRRRRRR.RR',
      '....NNNNFFKF.RRR',
      '...NNFNFFFKFFRRR',
      '...NFNNFFFKFFFRR',
      '...NFNNFFFFFFFRR',
      '...NNFFFFFKKKKRR',
      '....NFFFFKKKKKR.',
      '.....FFFFFFFFR..',
      '......FFFFFRR...',
      '...RRRRURRRRR...',
      '..RRRRRUURRRR...',
      '.RRRRRRUURRRR...',
      'RRRRRRUUUUUR....',
      'WWRRRUYUUYUU....',
      'WWW.UUUUUUUUU...',
      'WW.UUUUUUUUUUU..',
      '...UUUUUUUUUUUU.',
      '..UUUUUUU.UUUUU.',
      '..UUUUUU...UUUUU',
      '..UUUUU.....UUUU',
      '..UUUU......NNNN',
      '.NNNNN......NNNN',
      'NNNNNN.......NNN',
      'NNNNN.........NN',
      '.NNN............',
      '................',
      '................',
      '................'
    ],
    bigSkid: [
      '......RRRRR.....',
      '.....RRRRRRRR...',
      '....RRRRRRRRRRR.',
      '....RRRRRRRRR...',
      '....NNNNFFKF....',
      '...NNFNFFFKFF...',
      '...NFNNFFFKFFFF.',
      '...NFNNFFFFFFFFF',
      '...NNFFFFFKKKKK.',
      '..WWNFFFFKKKKK..',
      '.WWWWFFFFFFFF...',
      '.WWWRRFFFFF.....',
      '..RRRRRURRR.....',
      '..RRRRRUURRR....',
      '..RRRRRUUURRR...',
      '...RRRRUUUURR...',
      '...RRRUUYUUYU...',
      '....RUUUUUUUU...',
      '....UUUUUUUUUU..',
      '....UUUUUUUUUU..',
      '.....UUUUUUUUU..',
      '.....UUUUUUUUU..',
      '......UUUUUUUU..',
      '......UUUU.UUUNN',
      '......UUUU..NNNN',
      '.....NNNNN..NNNN',
      '....NNNNNN...NN.',
      '....NNNNN.......',
      '................',
      '................',
      '................',
      '................'
    ],
    bigCrouch: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '......RRRRR.....',
      '.....RRRRRRRR...',
      '....RRRRRRRRRRR.',
      '....RRRRRRRRR...',
      '....NNNNFFKF....',
      '...NNFNFFFKFF...',
      '...NFNNFFFKFFFF.',
      '...NNFFFFFKKKKK.',
      '....NFFFFKKKKK..',
      '..RRRFFFFFFFRR..',
      '.RRRRRRURRRRRRR.',
      'WWRRRRUURRRRRRWW',
      'WWWRRUUUURRRRWWW',
      'WWRRUYUUYURRRRWW',
      '..UUUUUUUUUUUU..',
      '.UUUUUUUUUUUUUU.',
      '.UUUUUUUUUUUUUU.',
      '.UUUUUU..UUUUUU.',
      'NNNNNN....NNNNNN',
      'NNNNNN....NNNNNN',
      '................',
      '................'
    ],
    bigClimb: [
      '..........WWW...',
      '......RRRRWWW...',
      '.....RRRRRRRR...',
      '....RRRRRRRRRR..',
      '....RRRRRRRRRRR.',
      '....NNNNFFKFRRR.',
      '...NNFNFFFKFRRR.',
      '...NFNNFFFKFRR..',
      '...NFNNFFFFFRR..',
      '...NNFFFFFKKRR..',
      '....NFFFFKKKRR..',
      '.....FFFFFFRR...',
      '......FFFFRR....',
      '....RRRURRR.....',
      '...RRRRURRR.....',
      '..RRRRRUURRWW...',
      '..RRRRRUUUWWW...',
      '..RRRRUYUUWWW...',
      '..RRRUUUUUUU....',
      '...UUUUUUUUU....',
      '...UUUUUUUUU....',
      '...UUUUUUUUU....',
      '...UUUUUUUUU....',
      '...UUUU.UUUU....',
      '...UUUU.UUUU....',
      '...UUUU.UUUU....',
      '...UUUU..NNNN...',
      '..NNNNN..NNNNN..',
      '.NNNNNN...NNNN..',
      '.NNNNN..........',
      '................',
      '................'
    ],

    // ---------------- 敌人 ----------------
    goomba: [
      '......OOOO......',
      '.....OOOOOO.....',
      '....OOOOOOOO....',
      '...OKKOOOOKKO...',
      '..OOOKKOOKKOOO..',
      '.OOOWKWOOWKWOOO.',
      '.OOOWKWOOWKWOOO.',
      'OOOOWWWOOWWWOOOO',
      'OOOOOOOOOOOOOOOO',
      'OOOOOTTTTTTOOOOO',
      '.OOOTTTTTTTTOOO.',
      '....TTTTTTTT....',
      '...TTTTTTTTKK...',
      '..KKKTTTTTKKKK..',
      '..KKKKK..KKKKKK.',
      '...KKKK..KKKKK..'
    ],
    goombaFlat: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '....OOOOOOOO....',
      '..OOKKOOOOKKOO..',
      '.OOWKWOOOOWKWOO.',
      'OOOOOOOOOOOOOOOO',
      '.OOOTTTTTTTTOOO.',
      '..TTTTTTTTTTTT..',
      '.KKKKKK..KKKKKK.',
      '.KKKKK....KKKKK.'
    ],
    // 乌龟 16×24（朝左绘制）
    koopa: [
      '.yyy............',
      'yyyyy...........',
      'yKyyy...........',
      'yKKyy...........',
      'yyyyyy..........',
      'yyyyyy..........',
      '.yyyyy..........',
      '..yyyy..........',
      '..yyyy..GGGG....',
      '..yyyy.GLLLLG...',
      '...yyyGLGGGGLG..',
      '...yyGLGLLLLGLG.',
      '....yGLGLGGLGLG.',
      '....WGLGLGGLGLGG',
      '...yyWGLGLLLGLGG',
      '..yyyyWGLGGGLGGG',
      '..yyyyWWGLLLGGGG',
      '...yy.WWWGGGGGGG',
      '......WWWWWWWWW.',
      '.......WWWWWWW..',
      '.....yyyy..yyyy.',
      '....yyyyy..yyyyy',
      '....KKKK...KKKKK',
      '...KKKKK....KKKK'
    ],
    koopa2: [
      '.yyy............',
      'yyyyy...........',
      'yKyyy...........',
      'yKKyy...........',
      'yyyyyy..........',
      'yyyyyy..........',
      '.yyyyy..........',
      '..yyyy..........',
      '..yyyy..GGGG....',
      '..yyyy.GLLLLG...',
      '...yyyGLGGGGLG..',
      '...yyGLGLLLLGLG.',
      '....yGLGLGGLGLG.',
      '....WGLGLGGLGLGG',
      '....WWGLGLLLGLGG',
      '.....WWGLGGGLGGG',
      '.....WWWGLLLGGGG',
      '......WWWGGGGGGG',
      '......WWWWWWWWW.',
      '.......WWWWWWW..',
      '.......yyyyyy...',
      '......yyyyyyyy..',
      '......KKKKKKKK..',
      '.....KKKKKKKKK..'
    ],
    shell: [
      '................',
      '................',
      '................',
      '................',
      '.....GGGGGG.....',
      '...GGLLGGLLGG...',
      '..GLLGGLLGGLLG..',
      '.GLGGGLGGLGGGLG.',
      '.GGLLGGLLGGLLGG.',
      'GLGGLGGGGGGLGGLG',
      'GGLLGGLLLLGGLLGG',
      'WWWWWWWWWWWWWWWW',
      'KWWWWWWWWWWWWWWK',
      '.KyyyKyyyyKyyyK.',
      '..KKKKKKKKKKKK..',
      '................'
    ],
    shellFeet: [
      '................',
      '.....GGGGGG.....',
      '...GGLLGGLLGG...',
      '..GLLGGLLGGLLG..',
      '.GLGGGLGGLGGGLG.',
      '.GGLLGGLLGGLLGG.',
      'GLGGLGGGGGGLGGLG',
      'GGLLGGLLLLGGLLGG',
      'WWWWWWWWWWWWWWWW',
      'KWWWWWWWWWWWWWWK',
      '.KyyyKyyyyKyyyK.',
      '..KKKKKKKKKKKK..',
      '.yyy........yyy.',
      'yyyyy......yyyyy',
      'KKKK........KKKK',
      '................'
    ],

    // ---------------- 道具 ----------------
    mushroom: [
      '......KKKK......',
      '....KKRRWWKK....',
      '...KRRRWWWWRK...',
      '..KRRRRWWWWRRK..',
      '.KWWRRRRWWRRRRK.',
      '.KWWWRRRRRRRWWK.',
      'KWWWWRRRRRRWWWWK',
      'KWWWRRRRRRRRWWWK',
      'KRRRRRRRRRRRRRRK',
      'KRRKKKKKKKKKKRRK',
      '.KKTTKTTTTKTTKK.',
      '..KTTKTTTTKTTK..',
      '..KTTTTTTTTTTK..',
      '..KTTTTTTTTTTK..',
      '...KTTTTTTTTK...',
      '....KKKKKKKK....'
    ],
    star: [
      '.......KK.......',
      '......KYYK......',
      '......KYYK......',
      '.....KYYYYK.....',
      'KKKKKKYYYYKKKKKK',
      'KYYYYYYYYYYYYYYK',
      '.KYYYYKYYKYYYYK.',
      '..KYYYKYYKYYYK..',
      '...KYYKYYKYYK...',
      '...KYYYYYYYYK...',
      '..KYYYYYYYYYYK..',
      '..KYYYYKKYYYYK..',
      '.KYYYKK..KKYYYK.',
      '.KYYK......KYYK.',
      'KYKK........KKYK',
      'KK............KK'
    ],
    coin0: [
      '................',
      '......KKKK......',
      '.....KYYYYK.....',
      '....KYYWWYYK....',
      '....KYWYYQYK....',
      '....KYWYYQYK....',
      '....KYWYYQYK....',
      '....KYWYYQYK....',
      '....KYWYYQYK....',
      '....KYWYYQYK....',
      '....KYWYYQYK....',
      '....KYYQQYYK....',
      '.....KYYYYK.....',
      '......KKKK......',
      '................',
      '................'
    ],
    coin1: [
      '................',
      '.......KKK......',
      '......KYYYK.....',
      '......KYWYK.....',
      '......KYWQK.....',
      '......KYWQK.....',
      '......KYWQK.....',
      '......KYWQK.....',
      '......KYWQK.....',
      '......KYWQK.....',
      '......KYWQK.....',
      '......KYQYK.....',
      '......KYYYK.....',
      '.......KKK......',
      '................',
      '................'
    ],
    coin2: [
      '................',
      '.......KK.......',
      '.......KK.......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '......KWYK......',
      '.......KK.......',
      '.......KK.......',
      '................',
      '................'
    ],
    debris: [
      '..OOOO..',
      '.OOPPOK.',
      'OOPOOOOK',
      'OPOOOOOK',
      'OOOOOOKK',
      '.OOOOKK.',
      '..KKKK..',
      '........'
    ],
    hudCoin: [
      '..YYYY..',
      '.YYWWYY.',
      '.YWYYQY.',
      '.YWYYQY.',
      '.YWYYQY.',
      '.YYQQYY.',
      '..YYYY..',
      '........'
    ],

    // ---------------- 图块 16×16 ----------------
    ground: [
      'OPPPPPPPPKOPPPPO',
      'POOOOOOOOKPOOOOK',
      'POOOOOOOOKPOOOOK',
      'POOOOOOOOKPOOOOK',
      'POOOOOOOOKKOOOOK',
      'POOOOOOOOKPKKKKO',
      'POOOOOOOOKPOOOOK',
      'POOOOOOOOKPOOOOK',
      'POOOOOOOOKPOOOOK',
      'KKOOOOOOKPOOOOOK',
      'PPKKOOOOKPOOOOOK',
      'POOPKKKKPOOOOOOK',
      'POOPOOOKPOOOOOOK',
      'POOPOOOKPOOOOOKK',
      'POOPOOOKPOOOOKKO',
      'OKKKKKKOKKKKKKOO'
    ],
    brick: [
      'PPPPPPPPPPPPPPPP',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'KKKKKKKKKKKKKKKK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'KKKKKKKKKKKKKKKK'
    ],
    question: [
      'DQQQQQQQQQQQQQQD',
      'QYYYYYYYYYYYYYYK',
      'QYKYYYYYYYYYYKYK',
      'QYYYYQQQQQYYYYYK',
      'QYYYQQKKKQQYYYYK',
      'QYYYQQKYYQQKYYYK',
      'QYYYYKKYYQQKYYYK',
      'QYYYYYYYQQQKYYYK',
      'QYYYYYYQQKKKYYYK',
      'QYYYYYYQQKYYYYYK',
      'QYYYYYYYKKYYYYYK',
      'QYYYYYYQQYYYYYYK',
      'QYYYYYYQQKYYYYYK',
      'QYKYYYYYKKYYYKYK',
      'QYYYYYYYYYYYYYYK',
      'KKKKKKKKKKKKKKKK'
    ],
    used: [
      'KKKKKKKKKKKKKKKK',
      'KOOOOOOOOOOOOOOK',
      'KOKOOOOOOOOOOKOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOOOOOOOOOOOOOOK',
      'KOKOOOOOOOOOOKOK',
      'KOOOOOOOOOOOOOOK',
      'KKKKKKKKKKKKKKKK'
    ],
    hard: [
      'PPPPPPPPPPPPPPPO',
      'PPPPPPPPPPPPPPOK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'PPOOOOOOOOOOOOKK',
      'POKKKKKKKKKKKKKK',
      'OKKKKKKKKKKKKKKK'
    ],
    pole: Array(16).fill('.......gg.......'),
    poleTop: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....KKKKKK.....',
      '....KGGGGLLK....',
      '...KGGGGGGLLK...',
      '...KGGGGGGGLK...',
      '...KGGGGGGGGK...',
      '...KGGGGGGGGK...',
      '....KGGGGGGK....',
      '.....KKKKKK.....',
      '.......gg.......',
      '.......gg.......',
      '.......gg.......'
    ],
    flag: [
      'WWWWWWWWWWWWWWWW',
      '.WWWWWWWWWWWWWWW',
      '..WWWWWGGGWWWWWW',
      '...WWWGLLLGWWWWW',
      '....WWGLGLGWWWWW',
      '.....WGLLLGWWWWW',
      '......WGGGWWWWWW',
      '.......WWWWWWWWW',
      '........WWWWWWWW',
      '.........WWWWWWW',
      '..........WWWWWW',
      '...........WWWWW',
      '............WWWW',
      '.............WWW',
      '..............WW',
      '...............W'
    ],
    castle: [
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'KKKKKKKKKKKKKKKK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'KKKKKKKKKKKKKKKK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO'
    ],
    castleTop: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      'OOOOOK....OOOOOK',
      'OOOOOK....OOOOOK',
      'KKKKKK....KKKKKK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO'
    ],
    castleArch: [
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO',
      'OOOKOOOOOOOKOOOO',
      'KKKKKKKKKKKKKKKK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOKKKKKKOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOKKKKKKKKKKKKOO',
      'OOKKKKKKKKKKKKOO',
      'KKKKKKKKKKKKKKKK',
      'OKKKKKKKKKKKKKKO',
      'OKKKKKKKKKKKKKKO',
      'KKKKKKKKKKKKKKKK',
      'KKKKKKKKKKKKKKKK'
    ],
    castleDoor: Array(16).fill('KKKKKKKKKKKKKKKK'),
    castleWindow: [
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKKKKKKKKKOOOO',
      'OOOKKKKKKKKKOOOO',
      'KKKKKKKKKKKKKKKK',
      'OOOKKKKKKKKKOOOK',
      'OOOKKKKKKKKKOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKKKKKKKKKOOOO',
      'OOOKKKKKKKKKOOOO',
      'KKKKKKKKKKKKKKKK',
      'OOOOOOOKOOOOOOOK',
      'OOOOOOOKOOOOOOOK',
      'KKKKKKKKKKKKKKKK',
      'OOOKOOOOOOOKOOOO'
    ],

    // ---------------- 背景（云/灌木共用形状，灌木为重映射） ----------------
    cloudL: [
      '................',
      '................',
      '................',
      '...........KKK..',
      '.........KKWWWK.',
      '........KWWWWWWK',
      '.....KKKWWWWWWWW',
      '....KWWWWWWWWWWW',
      '...KWWWWWWWWWWWW',
      '..KWWWWWWWWWWWWW',
      '.KWWWWWWWWWWWWWW',
      '.KWWWWWWWWWWWWWW',
      'KWWWWWWWWWWWWWWW',
      'KWWWWWWWWWWWWWWW',
      'KWWWWWWWWWWWWWWW',
      'KWWWWCWWWWWWWWWW',
      '.KWWCCWWWWWWWWWW',
      '.KWCCWWWWWWWWWWW',
      '..KCWWWWWWCWWWWW',
      '...KKWWWWCCWWWWW',
      '.....KKKCCWWWWWW',
      '........KKKKKKKK',
      '................',
      '................'
    ],
    cloudM: [
      '.....KKKKK......',
      '...KKWWWWWKK....',
      '..KWWWWWWWWWK...',
      '.KWWWWWWWWWWWK..',
      'KWWWWWWWWWWWWWK.',
      'WWWWWWWWWWWWWWWK',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWWWW',
      'WWWWWCWWWWWWWWWW',
      'WWWWCCWWWWWWCWWW',
      'WWWCCWWWWWWCCWWW',
      'KKKCKKKKKKKCKKKK',
      'KKKKKKKKKKKKKKKK',
      '................',
      '................'
    ].map(r => r.slice(0, 16)),
    cloudR: [
      '................',
      '................',
      '................',
      '..KKK...........',
      '.KWWWKK.........',
      'KWWWWWWK........',
      'WWWWWWWWKKK.....',
      'WWWWWWWWWWWK....',
      'WWWWWWWWWWWWK...',
      'WWWWWWWWWWWWWK..',
      'WWWWWWWWWWWWWWK.',
      'WWWWWWWWWWWWWWK.',
      'WWWWWWWWWWWWWWWK',
      'WWWWWWWWWWWWWWWK',
      'WWWWWWWWWWWWWWWK',
      'WWWWWWWWWWCWWWWK',
      'WWWWWWWWWCCWWWK.',
      'WWWWWWWWCCWWWWK.',
      'WWWWWWWCCWWWWK..',
      'WWWWWWCCWWWKK...',
      'WWWWWCCKKKK.....',
      'KKKKKKKK........',
      '................',
      '................'
    ]
  };

  // ------------------------------------------------------------------
  // 生成型精灵：水管与山丘（由参数生成字符串，仍集中在数据对象中）
  // ------------------------------------------------------------------

  /** 由列颜色模式生成 rows 行的精灵 */
  function stripes(pattern, rows, edgeTop, edgeBottom) {
    const out = [];
    for (let r = 0; r < rows; r++) {
      if ((edgeTop && r === 0) || (edgeBottom && r === rows - 1)) out.push(pattern.replace(/[^.]/g, 'K'));
      else out.push(pattern);
    }
    return out;
  }
  const PIPE_TOP = 'KgLLLgggggggggggggGgGGGGGGGGGGGK';   // 32 列（管口）
  const PIPE_BODY = '..KgLLggggggggggggGgGGGGGGGGGK..';  // 32 列（管身）
  const pipeTop = stripes(PIPE_TOP, 16, true, true);
  const pipeBody = stripes(PIPE_BODY, 16, false, false);
  SPRITES.pipeTL = pipeTop.map(r => r.slice(0, 16));
  SPRITES.pipeTR = pipeTop.map(r => r.slice(16));
  SPRITES.pipeBL = pipeBody.map(r => r.slice(0, 16));
  SPRITES.pipeBR = pipeBody.map(r => r.slice(16));
  // 侧向水管（地下奖励房出口）：管口竖向条纹
  const sideMouth = [];
  for (let r = 0; r < 32; r++) sideMouth.push(r === 0 || r === 31 ? 'KKKKKKKKKKKKKKKK' : 'K' + PIPE_TOP[r].repeat(14) + 'K');
  SPRITES.sidePipeMT = sideMouth.slice(0, 16);
  SPRITES.sidePipeMB = sideMouth.slice(16);
  const sideBody = [];
  for (let r = 0; r < 32; r++) sideBody.push(r < 2 || r > 29 ? '................' : PIPE_BODY[r].repeat(16).replace(/\./g, 'K'));
  SPRITES.sidePipeBT = sideBody.slice(0, 16);
  SPRITES.sidePipeBB = sideBody.slice(16);

  /** 山丘：半椭圆 + 描边 + 斑点 */
  function hill(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - w / 2) / (w / 2), ny = (h - y - 0.5) / h;
        const inside = nx * nx * 0.95 + ny * ny * 1.05 <= 1 && Math.abs(nx) <= 1 - Math.pow(ny, 3) * 0.55;
        const edgeL = (x - 1 + 0.5 - w / 2) / (w / 2), edgeR = (x + 1 + 0.5 - w / 2) / (w / 2), edgeU = (h - y + 0.5) / h;
        const isIn = (a, b) => a * a * 0.95 + b * b * 1.05 <= 1 && Math.abs(a) <= 1 - Math.pow(b, 3) * 0.55;
        if (!inside) row += '.';
        else if (!isIn(edgeL, ny) || !isIn(edgeR, ny) || !isIn(nx, edgeU)) row += 'K';
        else {
          const sx = x % 16, sy = (y + (Math.floor(x / 16) % 2) * 6) % 13;
          const spot = (sx >= 4 && sx <= 6 && sy >= 3 && sy <= 9) || (sx >= 10 && sx <= 11 && sy >= 6 && sy <= 9);
          row += spot && y > 6 ? 'h' : 'G';
        }
      }
      rows.push(row);
    }
    return rows;
  }
  SPRITES.hillBig = hill(80, 35);
  SPRITES.hillSmall = hill(48, 19);

  // ------------------------------------------------------------------
  // 颜色重映射（调色板键 → 键）
  // ------------------------------------------------------------------
  const REMAPS = {
    bush: { W: 'g', C: 'G' },
    oneup: { R: 'G', W: 'W' },
    under: { O: 'b', P: 's', K: 'K', D: 'K' },
    underGround: { O: 'c', P: 's' },
    q1: { Y: 'Q' },
    q2: { Y: 'O' },
    fire: { R: 'W', U: 'R', N: 'R' },
    star1: { R: 'G', U: 'O', N: 'O', F: 'y' },
    star2: { R: 'K', U: 'R', N: 'K', F: 'F' },
    star3: { R: 'W', U: 'R', N: 'R', W: 'R' },
    deadEnemy: {}
  };

  // ------------------------------------------------------------------
  // 关卡 1-1（单位：图块；行 0 在顶端，地面第 13–14 行）
  // ------------------------------------------------------------------
  const blocksMain = [
    [16, 9, '?', 'coin'],
    [20, 9, 'B'], [21, 9, '?', 'mushroom'], [22, 9, 'B'], [23, 9, '?', 'coin'], [24, 9, 'B'],
    [22, 5, '?', 'coin'],
    [64, 8, 'H', '1up'],
    [77, 9, 'B'], [78, 9, '?', 'mushroom'], [79, 9, 'B'],
    [80, 5, 'B'], [81, 5, 'B'], [82, 5, 'B'], [83, 5, 'B'], [84, 5, 'B'], [85, 5, 'B'], [86, 5, 'B'], [87, 5, 'B'],
    [91, 5, 'B'], [92, 5, 'B'], [93, 5, 'B'], [94, 5, '?', 'coin'],
    [94, 9, 'B', 'coins'],
    [100, 9, 'B'], [101, 9, 'B', 'star'],
    [106, 9, '?', 'coin'], [109, 9, '?', 'coin'], [109, 5, '?', 'mushroom'], [112, 9, '?', 'coin'],
    [118, 9, 'B'],
    [121, 5, 'B'], [122, 5, 'B'], [123, 5, 'B'],
    [128, 5, 'B'], [129, 5, '?', 'coin'], [130, 5, '?', 'coin'], [131, 5, 'B'],
    [129, 9, 'B'], [130, 9, 'B'],
    [168, 9, 'B'], [169, 9, 'B'], [170, 9, '?', 'coin'], [171, 9, 'B']
  ];
  const stairs = (x0, heights) => heights.map((h, i) => [x0 + i, h]);

  const LEVEL = {
    name: '1-1',
    time: 400,
    start: { x: 40, bottom: 208 },
    areas: {
      main: {
        width: 212,
        theme: 'overworld',
        ground: [[0, 68], [71, 85], [89, 152], [155, 211]],
        pipes: [[28, 2], [38, 3], [46, 4], [57, 4, 'warp'], [163, 2, 'exit'], [179, 2]],
        blocks: blocksMain,
        stairs: [].concat(
          stairs(134, [1, 2, 3, 4]), stairs(140, [4, 3, 2, 1]),
          stairs(148, [1, 2, 3, 4, 4]), stairs(155, [4, 3, 2, 1]),
          stairs(181, [1, 2, 3, 4, 5, 6, 7, 8, 8])
        ),
        flag: { x: 198, top: 2 },
        castle: { x: 202 },
        enemies: [
          ['goomba', 22, 12], ['goomba', 40, 12], ['goomba', 51, 12], ['goomba', 52.5, 12],
          ['goomba', 80, 4], ['goomba', 82, 4], ['goomba', 97, 12], ['goomba', 98.5, 12],
          ['koopa', 107, 12], ['goomba', 114, 12], ['goomba', 115.5, 12],
          ['goomba', 124, 12], ['goomba', 125.5, 12], ['goomba', 128, 12], ['goomba', 129.5, 12],
          ['goomba', 174, 12], ['goomba', 175.5, 12]
        ],
        warps: [{ x: 57, to: 'bonus', entry: { x: 34, y: 16 } }],
        exitPipe: { x: 163 }
      },
      bonus: {
        width: 16,
        theme: 'underground',
        ground: [[0, 15]],
        pipes: [],
        blocks: [].concat(
          Array.from({ length: 11 }, (_, i) => [0, 2 + i, 'B']),
          Array.from({ length: 7 }, (_, i) => [4 + i, 2, 'B']),
          Array.from({ length: 21 }, (_, i) => [4 + (i % 7), 10 + Math.floor(i / 7), 'B']),
          Array.from({ length: 7 }, (_, i) => [4 + i, 9, 'C']),
          Array.from({ length: 7 }, (_, i) => [4 + i, 7, 'C']),
          Array.from({ length: 5 }, (_, i) => [5 + i, 5, 'C'])
        ),
        sidePipe: { x: 13, y: 11, column: 15 },
        stairs: [],
        enemies: []
      }
    },
    // 背景装饰图案（每 48 图块重复一次；layer 决定视差系数）
    scenery: {
      period: 48,
      items: [
        ['hillBig', 0, 'hills'], ['cloud1', 8, 'clouds', 3], ['bush3', 11, 'bushes'], ['hillSmall', 16, 'hills'],
        ['cloud1', 19, 'clouds', 2], ['bush1', 23, 'bushes'], ['cloud3', 27, 'clouds', 3], ['cloud2', 36, 'clouds', 2],
        ['bush2', 41, 'bushes']
      ],
      parallax: { clouds: 0.5, hills: 0.7, bushes: 0.85 }
    }
  };

  // ------------------------------------------------------------------
  // 物理常数（像素/帧，60 FPS；参照 NES 原版的子像素数值换算）
  // ------------------------------------------------------------------
  const PHYSICS = {
    minWalk: 0x130 / 0x1000,      // 0.074
    walkAccel: 0x98 / 0x1000,     // 0.037
    runAccel: 0xE4 / 0x1000,      // 0.056
    releaseDecel: 0xD0 / 0x1000,  // 0.051
    skidDecel: 0x1A0 / 0x1000,    // 0.102
    maxWalk: 0x1900 / 0x1000,     // 1.5625
    maxRun: 0x2900 / 0x1000,      // 2.5625
    skidTurn: 0x900 / 0x1000,     // 0.5625
    maxFall: 4.5,
    // 起跳初速度与“按住 A / 松开 A”时的重力，按起跳时的水平速度分三档
    jump: [
      { below: 1.0, v: -4.0, hold: 0x20 / 0x100, fall: 0x70 / 0x100 },
      { below: 2.3125, v: -4.0, hold: 0x1E / 0x100, fall: 0x60 / 0x100 },
      { below: Infinity, v: -5.0, hold: 0x28 / 0x100, fall: 0x90 / 0x100 }
    ],
    stompBounce: -4.0,
    enemySpeed: 0.5,
    enemyGravity: 0.25,
    shellSpeed: 3.0,
    itemSpeed: 1.0,
    timeTick: 24,                 // 每 24 帧游戏时间减 1（与原版一致）
    invulnFrames: 120,
    starFrames: 600
  };

  // ------------------------------------------------------------------
  // 背景音乐（原创旋律，16 分音符步进；'-' 延音，'.' 休止）
  // ------------------------------------------------------------------
  const MUSIC = {
    tempo: 112,
    step: 4,
    tracks: [
      {
        wave: 'square', vol: 0.09,
        notes: [
          'G5 - . E5 . G5 . C6 - - . B5 . A5 . G5',
          '- - E5 . C5 . E5 . A5 - - . G5 . E5 .',
          'F5 - . A5 . C6 . A5 - . G5 . F5 . E5 .',
          'D5 - - . G5 - - . B5 . A5 . G5 - - .',
          'C6 . G5 . E5 . G5 . C6 - . D6 . C6 . B5',
          'A5 - . E5 . A5 . C6 - - . B5 . A5 . E5',
          'F5 . A5 . D6 . A5 . G5 . B5 . D6 . B5 .',
          'C6 - - . G5 . E5 . C5 - - - . . . .'
        ].join(' ')
      },
      {
        wave: 'square', vol: 0.045,
        notes: [
          '. . E4 . . . E4 . . . E4 . . . E4 .',
          '. . E4 . . . C4 . . . E4 . . . C4 .',
          '. . A4 . . . F4 . . . A4 . . . F4 .',
          '. . B4 . . . G4 . . . B4 . . . D4 .',
          '. . E4 . . . G4 . . . E4 . . . G4 .',
          '. . E4 . . . C4 . . . E4 . . . C4 .',
          '. . F4 . . . A4 . . . B4 . . . D4 .',
          '. . E4 . . . G4 . . . E4 . . . . .'
        ].join(' ')
      },
      {
        wave: 'triangle', vol: 0.32,
        notes: [
          'C3 . . C3 . . G2 . C3 . . C3 . . G2 .',
          'A2 . . A2 . . E2 . A2 . . A2 . . E2 .',
          'F2 . . F2 . . C3 . F2 . . F2 . . C3 .',
          'G2 . . G2 . . D3 . G2 . . G2 . . B2 .',
          'C3 . . C3 . . G2 . C3 . . C3 . . G2 .',
          'A2 . . A2 . . E2 . A2 . . A2 . . E2 .',
          'D3 . . D3 . . A2 . G2 . . G2 . . D3 .',
          'C3 . . C3 . . G2 . C3 . . . . . . .'
        ].join(' ')
      }
    ]
  };

  DOS.MarioData = { PALETTE, SPRITES, REMAPS, LEVEL, PHYSICS, MUSIC };
})(typeof globalThis !== 'undefined' ? globalThis : this);
