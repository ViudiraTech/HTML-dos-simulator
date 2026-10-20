# HTML-DOS 6.22 — 浏览器里的 MS-DOS 仿真模拟器

纯原生 HTML5 / CSS / JavaScript 实现的 MS-DOS 风格命令行环境：80×25 文本模式、VGA Mode 13h
图形模式、批处理解释器、带持久化的虚拟磁盘，以及致敬 NES《超级马里奥兄弟》1-1 关卡的原创小游戏
`MARIO.COM`。无第三方库、无构建步骤。

> **免责声明**：`MARIO.COM` 是非商业的致敬性**原创实现**。所有像素图与音符均为本项目原创绘制/作曲，
> 未使用任何任天堂 ROM 或受版权保护的素材文件，仅在风格与玩法上致敬原作；本项目与任天堂（Nintendo）
> 无任何关联，也未获其认可。MS-DOS 是 Microsoft 的商标，本项目同样与 Microsoft 无关联。

## 运行

| 方式 | 说明 |
|---|---|
| GitHub Pages | 在仓库 Settings → Pages 选择分支根目录发布，访问 `https://<user>.github.io/HTML-dos-simulator/`（`index.html` 会跳转到 `dos.html`）。 |
| 本地直接打开 | 双击 `dos.html`（`file://` 下可用，不需要服务器）。 |
| 本地服务器 | `npx http-server .` 或 `python3 -m http.server`，再打开 `/dos.html`。 |

启动后会显示模拟 BIOS 自检（按 **Esc** 跳过），随后执行 `AUTOEXEC.BAT` 并进入 `C:\>` 提示符。
输入 `MARIO` 回车即可开始游戏（`MARIO /M` 关闭背景音乐，`MARIO /?` 查看按键）。

支持最新版 Chrome、Firefox、Safari、Edge。音频在首次按键/点击后启用（浏览器自动播放限制）。

## 功能一览

**文本模式**：80×25、16 色 CGA/EGA 调色板、9×16 字符单元的位图字体（8×8 字形 + 程序生成的 CP437
制表/方块字形）；闪烁块状光标（Insert 切换插入/覆盖，覆盖模式为下划线光标）；1000 行滚动缓冲；
可选 CRT 效果（扫描线、光晕、暗角）；4 种主题（Classic VGA 灰 `#AAAAAA`/黑、Green、Amber、Blue）。

**行编辑**：←/→（Ctrl 按词）、Home/End、Backspace/Delete、Insert、↑/↓ 历史（100 条）、F1/F3（逐字/整行
复制上一条命令）、Tab/Shift+Tab 补全命令与文件名并循环候选、Esc 清行、Ctrl+C 中止、F6/Ctrl+Z 输入 ^Z、
Ctrl+L 清屏、Shift+PgUp/PgDn 或鼠标滚轮回看、F12 快捷键帮助面板。命令行上限 127 字符（与 DOS 一致）。

**虚拟文件系统**：`A:`（1.44MB 空软盘）与 `C:`（512MB），8.3 文件名、大小写不敏感、统一大写显示；
文本按字符串、二进制按 Base64 存储；每次修改同步写入 `localStorage`；`FORMAT` 清空磁盘；
工具栏 *Factory reset* 恢复出厂内容。初始 `C:`：`COMMAND.COM`、`IO.SYS`/`MSDOS.SYS`（隐藏）、
`CONFIG.SYS`、`AUTOEXEC.BAT`、`README.TXT`、`GAMES\`（PLASMA.COM、BALL.COM）、
`UTILS\`（示例批处理 DEMO、HELLO、ARGS、COUNT、FOREVER、MENU、GFX）、`MARIO\`（MARIO.COM、MARIO.TXT）、`TEMP\`。

**内置命令（46 个，表驱动注册）**

| 类别 | 命令 |
|---|---|
| 文件 | `DIR`（/W /P /A[:属性] /O /S /B，`*`/`?`）、`CD`/`CHDIR`、`MD`/`MKDIR`、`RD`/`RMDIR`（/S /Q）、`TYPE`、`COPY`（通配符、/Y /-Y、`a+b` 合并、`COPY CON`）、`DEL`/`ERASE`（/P）、`REN`/`RENAME`（通配符模板）、`MOVE`、`ATTRIB`（±R ±H ±S ±A /S）、`TREE`（/F /A）、`FC`（/C /N） |
| 系统 | `ECHO`、`CLS`、`VER`、`VOL`、`DATE`、`TIME`（真实时钟，可设置偏移）、`SET`、`PATH`、`PROMPT`（$P $G $N $_ $T $D $V $L $B $Q $H $$）、`HELP`、`PAUSE`、`REM`、`CALL`、`EXIT`、`MEM`（/C）、`CHKDSK`（/V）、`FORMAT`（/S /Q /V）、`LABEL`、`DOSKEY /HISTORY` |
| 批处理 | `IF`（EXIST / ERRORLEVEL / 字符串比较 / NOT / /I）、`GOTO`、`FOR %%A IN (...) DO`（含通配符）、`SHIFT`、`CHOICE`（/C /N /S /T） |
| 过滤器 | `MORE`、`SORT`（/R /+n）、`FIND`（/V /C /N /I），支持管道 `|` 与重定向 `>` `>>` `<` |
| 图形/娱乐/界面 | `MODE 13` / `MODE 3`（`MODE 80`、`CO80`）、`BEEP [Hz] [ms]`、`MARIO`、`COLOR`、`THEME`、`CRT` |

每个命令都支持 `/?`（或 `HELP 命令名`）。未知命令显示 `Bad command or file name`。
外部命令查找顺序：内部命令 → 当前目录 → `PATH` 中各目录，依次尝试 `.COM`、`.EXE`、`.BAT`。
`.COM`/`.EXE` 是带签名 `HTMLDOS:<ID>` 的二进制存根，执行时按签名分派到 JS 实现，因此复制到 `A:` 也能运行。

**批处理**：`@ECHO OFF`/`ECHO ON|OFF`、`REM`、`::`、`%0`–`%9`、`%*`、`%%`、`%VAR%`、`IF`、`GOTO`/`:label`、
`FOR`、`CALL`（嵌套返回）、直接调用另一个 .BAT 时链式跳转（不返回，与 DOS 一致）、`SHIFT`、`CHOICE`、
Ctrl+C 时提示 `Terminate batch job (Y/N)?`。

**图形模式**：`MODE 13` 进入 320×200×256（VGA 默认调色板结构），此时命令行以 40×25、8×8 字体在
图形缓冲中显示；`MODE 3` 返回文本模式。画面按整数倍缩放并居中（保持像素比例）。
JS API（`machine.gfx`）：`pset`/`pget`、`line`（Bresenham）、`rect`、`fillRect`、`circle`、`fillCircle`、
`text`（8×8 位图字体）、`blit`（颜色 0 透明，支持翻转与颜色重映射）、`setPalette`/`getPalette`/`resetPalette`、
`swap`（双缓冲提交）、`waitVBlank`（≈60Hz）；按键状态查询 `machine.input.isDown(code)`。
程序返回或按 Esc 时自动回到 80×25 文本模式并恢复原屏幕内容。示例程序：`PLASMA.COM`（调色板循环等离子）、
`BALL.COM`（弹球；方向键改变重力、空格加球、C 清空，屏幕下方实时显示方向键按下状态）。

## MARIO.COM

| 按键 | 作用 |
|---|---|
| ← / →（或 A / D） | 移动 |
| ↓（或 S） | 下蹲（大体）/ 进入水管 |
| Z 或 Space | 跳跃（A 键，按住跳得更高） |
| X 或 Shift | 奔跑（B 键） |
| Enter | 开始 / 暂停（显示 `PAUSE`） |
| Esc | 退出回到 DOS |

- **分辨率取舍**：使用 NES 原生 256×240 的 256 色索引缓冲（`MODE 13` 风格的调色板与绘图 API），由界面层整数倍缩放、
  上下/左右加黑边居中（letterbox）。缩放进 320×200 会破坏 16px 图块的像素网格，裁剪 40 行又会丢失 HUD 或地面，
  因此选择保持原生网格（说明同样写在 `js/mario.js` 顶部注释中）。
- **关卡 1-1**：长度 212 图块；坑洞位于 69–70、86–88、153–154；问号方块/砖块（含蘑菇、金币、10 连金币砖、星星砖）、
  位于 64 的隐藏 1UP 方块、6 根水管（57 号可进入地下奖励房，163 号为出口）、四组阶梯、Goomba ×16、Koopa ×1、
  旗杆（198）与城堡。数据在 `js/mario-data.js` 中以数组描述，便于核对。
- **物理**：固定 60Hz 逻辑步长（与渲染分离，渲染帧率不影响手感）；走/跑两档加速度与最高速度、滑行转向减速、
  三档起跳速度与“按住 A / 松开 A”两种重力（静止短跳约 20px、长跳约 66px，奔跑长跳约 83px）、空中惯性、
  先水平后垂直的 AABB 图块碰撞。数值由 NES 原版的子像素常数换算而来。
- **玩法**：顶问号块出金币/蘑菇；蘑菇变大，大体受伤变小并短暂无敌；小体顶砖只会弹动、大体可顶碎；
  踩 Goomba 弹跳并按连踩递增计分；踩 Koopa 变壳，再碰/踩可踢壳，移动的壳会撞死其他敌人；侧撞死亡（跳起后落下的动画）、
  掉坑死亡、TIME 归零死亡；死亡后重开本关并减命，生命为 0 显示 `GAME OVER`；100 金币加命；
  旗杆按高度计分、沿杆滑下、走进城堡、剩余时间换分，显示 `COURSE CLEAR!` 并提示 Enter 再玩 / Esc 返回 DOS；
  最高分保存在 `localStorage`（`htmldos.mario.hiscore`）。
- **音频**：Web Audio 方波/三角波合成：跳跃、踩踏、金币、蘑菇出现、变大、1UP、顶砖、碎砖、踢壳、受伤、死亡、
  旗杆、过关、暂停、时间警告；原创的 8 小节背景音乐（主旋律 + 和声 + 三角波低音），时间少于 100 时加速。

### 与原版的已知差异

- 美术为原创像素画，只在风格上接近：马里奥采用红衣/蓝背带裤/白手套配色，帧数与细节与原版不同；
  地面、云、山丘、城堡等图块均为自绘。
- 背景音乐与所有乐句（死亡、过关、Game Over、1UP 等）为原创作曲，**不是**原版旋律的转写——
  这与“所有音符数据均为原创”的约束一致；`MarioData.MUSIC` 是普通的音符表，可自行替换。
- 未实现火焰花（大体顶出蘑菇块仍给蘑菇，仅加分）、中途检查点、烟花、城堡升旗、角色重叠时的精灵闪烁限制、
  走出画面左侧后敌人回收等细节；星星已实现（无敌并撞飞敌人），但没有专用音乐。
- 视差（远景云 0.5×、山丘 0.7×、灌木 0.85×）是按要求新增的效果，原版背景与前景同速滚动。
- 奖励房与出口水管为简化布局；砖块碎片/顶起动画为近似实现。

## 代码结构

所有模块挂在全局 `DOS` 命名空间下，可变状态集中在 `DOS.Machine` 实例中（浏览器控制台可用 `machine` 访问）。

| 模块 | 文件 | 职责 |
|---|---|---|
| Terminal | `js/terminal.js` | 字符网格、光标、滚动缓冲、文本模式渲染器、MODE 13 控制台渲染、颜色主题 |
| Input | `js/input.js` | 键盘事件规范化、按键队列/状态、行编辑器、历史、Tab 补全 |
| FileSystem | `js/filesystem.js`、`js/disk-image.js` | 虚拟磁盘、路径解析、通配符、持久化；出厂磁盘内容 |
| Parser | `js/parser.js`、`js/batch.js` | 命令行切分、开关、变量展开、管道/重定向、IF/FOR；批处理解释器 |
| Commands | `js/commands.js` | 表驱动内置命令注册表（`Commands.register({...})` 即可新增命令） |
| Graphics | `js/graphics.js` | 索引色帧缓冲、256 色调色板、绘图原语、双缓冲 |
| Audio | `js/audio.js` | BEEP、音效表、乐句与循环音乐合成 |
| Programs | `js/programs.js` | 外部程序注册表：COMMAND、PLASMA、BALL、MARIO |
| MarioGame | `js/mario.js`、`js/mario-data.js` | `MarioGame`（状态与物理）、`MarioRenderer`（只读渲染）、`MarioProgram`（宿主循环）；精灵/关卡/物理/音乐数据 |
| Machine | `js/machine.js` | 集中状态、执行管线、外壳循环、显示模式切换、BIOS 自检 |
| — | `js/font.js`、`js/main.js` | 位图字体；浏览器接线（布局、渲染循环、工具栏、帮助面板、aria-live） |

## 测试

```bash
node tests/run-tests.js            # 全部 57 项（无依赖，Node 18+）
node tests/run-tests.js Mario      # 按名称过滤
```

浏览器中打开 `tests/test.html` 运行同一套用例。覆盖 Parser、FileSystem、批处理解释器（含 Ctrl+C 终止）、
内置命令的正常/错误路径、行编辑与历史、Graphics 原语与程序进出图形模式，以及 MarioGame 物理：
短跳与长跳高度差、奔跑速度与跳跃、转向滑行、墙体碰撞、踩踏弹跳、Koopa 壳、侧撞死亡、掉坑死亡与 GAME OVER、
蘑菇变大与受伤变小（含无敌时间）、顶砖、时间耗尽、暂停、1-1 数据核对、水管往返奖励房，以及一个自动驾驶
脚本从起点跑完整个 1-1 并到达 `COURSE CLEAR`。

## 手动验证清单（结果）

验证环境：Node 22（单元测试）+ Playwright 驱动的 Chromium（真实键盘事件、截图检查），2026-10-20。

| 项目 | 结果 |
|---|---|
| 每个内置命令的正常路径与错误路径（`Bad command or file name`、`File not found`、`Invalid directory`、`Unable to create directory`、`Required parameter missing`、`Access denied`、`Invalid drive specification` 等） | ✅ 通过（单元测试 + 手工执行） |
| `DIR *.TXT`、`COPY C:\UTILS\*.BAT A:`（7 个文件）、`DEL A?.TMP`、`DEL *.*` 确认提示 | ✅ 通过 |
| 空输入、不存在的路径、超长命令（>127 字符被截断并响铃）、连续退格、根目录 `CD ..` | ✅ 通过 |
| Tab 补全（`ty`+Tab → `TYPE`，`REA`+Tab → `README.TXT`）、↑ 历史、Insert 覆盖、Shift+PgUp 回看 | ✅ 通过（Chromium 真实按键） |
| `MODE 13` 后 `PLASMA`、`BALL` 正常运行，Esc 返回 80×25 文本模式并恢复原屏幕 | ✅ 通过（截图确认） |
| `MARIO` 完整走完 1-1：开始、跳坑、顶问号方块、踩 Goomba、过水管、旗杆、`COURSE CLEAR` | ✅ 通过（自动驾驶脚本在 Node 中完整通关；浏览器中截图确认旗杆滑落、进城堡、时间结算与 COURSE CLEAR 画面） |
| 死亡后扣命重开，生命为 0 显示 `GAME OVER` | ✅ 通过（单元测试 + 浏览器截图） |
| 刷新页面后文件保留、最高分保留；`FORMAT` 后磁盘清空（`/S` 写回系统文件） | ✅ 通过 |
| 含 `IF`、`GOTO`、`FOR`、`CALL`、`CHOICE` 的批处理（`DEMO hello world`）正确执行，`FOREVER.BAT` 用 Ctrl+C → Y 中止 | ✅ 通过 |
| 主题切换、CRT 开关、F12 帮助面板、窄屏横向滚动、无 JS 控制台错误、`file://` 直接打开 | ✅ 通过 |
| 音频（BEEP、音效、音乐）的实际听感 | ⚠️ 未自动验证：无头浏览器无音频输出，仅确认代码路径无报错；Firefox/Safari/Edge 未实机测试 |

## 已知限制

- 不是 x86 模拟器：`.COM/.EXE` 只能运行内置 JS 程序（按签名分派），任意二进制会提示 `Program too big to fit in memory`。
- 只支持英文键盘布局的可打印字符；没有移动端虚拟键盘支持。
- `EXIT` 不能退出主命令解释器；不支持 `XCOPY`、`EDIT`、`DELTREE`、`ANSI.SYS` 转义序列。
- `localStorage` 容量约 5MB，超过时写入会静默失败（内存中的数据仍有效）。
- Chrome 等浏览器可能不允许网页拦截 F12（开发者工具），此时可用工具栏上的 *Help (F12)* 按钮。
