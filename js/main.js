/*
 * main.js —— 浏览器启动：DOM 连接、渲染循环、布局、顶栏、状态 HUD、指示灯、帮助面板、无障碍播报
 * ---------------------------------------------------------------
 * 只做“接线”，不保存业务状态：所有状态都在 Machine 实例中。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS;

  function safeStorage() {
    try {
      const s = root.localStorage;
      const k = '__htmldos_probe__';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) { return null; }
  }

  function start() {
    const $ = (id) => document.getElementById(id);
    const monitor = $('monitor'), screen = $('screen');
    const textCanvas = $('text-canvas'), gfxCanvas = $('gfx-canvas'), glowCanvas = $('glow-canvas');
    const live = $('sr-live'), help = $('help-panel');
    const storage = safeStorage();

    const m = new DOS.Machine({ storage });
    root.machine = m; // 便于调试
    const textRenderer = new DOS.TextRenderer(textCanvas);
    m.gfx.attach(gfxCanvas);
    m.input.attach(root);
    const glowCtx = glowCanvas.getContext('2d');

    // ---------------- 无障碍：aria-live 播报 ----------------
    let pending = [];
    let flushTimer = null;
    const announce = (text) => {
      if (!text || !text.trim()) return;
      pending.push(text);
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const div = document.createElement('div');
        div.textContent = pending.join('\n');
        pending = [];
        live.appendChild(div);
        while (live.childNodes.length > 20) live.removeChild(live.firstChild);
      }, 120);
    };
    m.term.onLine = announce;
    m.onAnnounce = announce;

    // ---------------- 布局：4:3 显示器，图形按整数倍缩放 ----------------
    /** 元素在文档流中占用的高度（隐藏或 position:fixed 悬浮时为 0） */
    const flowHeight = (el) => (el && el.offsetParent !== null ? el.offsetHeight : 0);
    function layout() {
      const touch = document.body.classList.contains('touch');
      // 手机上内容一旦溢出，innerWidth 会随之变大（布局视口被撑宽），所以取 clientWidth 的较小值
      const vw = Math.min(root.innerWidth, document.documentElement.clientWidth || root.innerWidth), vh = root.innerHeight;
      const small = vw <= 760 || vh <= 540; // 手机竖屏或横屏
      // 预留顶栏、显示器下巴（指示灯一栏）、触屏按键/手柄、状态 HUD（手机上 HUD 放在下方可滚动，不参与计算）与边距
      // 手柄尺寸：竖屏按屏幕宽度；横屏玩游戏时按画面两侧留白（下面算出画面宽度后再改写）。
      // 用 JS 计算而不是 CSS min()，以兼容较老的手机内核（如部分 App 内置浏览器）
      const padEl = $('gamepad');
      padEl.style.setProperty('--d', Math.floor(Math.min(vw * 0.36, 156)) + 'px');
      padEl.style.setProperty('--f', Math.floor(Math.min(vw * 0.15, 68)) + 'px');
      const bar = flowHeight(document.querySelector('.topbar'));
      const chin = flowHeight(document.querySelector('.chin'));
      const hud = touch || small ? 0 : flowHeight($('hud'));
      const controls = flowHeight($('touch-keys')) + flowHeight($('gamepad'));
      const availW = Math.min(vw - (small ? 28 : 64), 1400);
      const availH = vh - bar - chin - hud - controls - (small ? 36 : 96);
      // 手机上玩图形程序时，屏幕框按画面比例收紧，不再留 4:3 的黑边
      const gw = m.gfx.width, gh = m.gfx.height;
      const aspect = touch && m.display !== 'text' ? gw / gh : 4 / 3;
      const W = Math.floor(Math.max(small ? 240 : 640, Math.min(availW, availH * aspect)));
      const H = Math.floor(W / aspect);
      screen.style.width = W + 'px';
      screen.style.height = H + 'px';
      if (touch && m.display === 'gfx' && vw > vh && vh <= 540) {
        // 横屏：手柄悬浮在画面两侧的留白里
        const gutter = Math.max(0, Math.floor((vw - W) / 2 - 12));
        padEl.style.setProperty('--d', Math.floor(Math.max(72, Math.min(gutter - 8, vh * 0.44, 156))) + 'px');
        padEl.style.setProperty('--f', Math.floor(Math.max(40, Math.min((gutter - 20) / 2, vh * 0.2, 68))) + 'px');
      }
      // 文本模式留出少量“过扫描”黑边，避免首列字符贴住圆角显像管边缘
      const pad = Math.round(W * 0.025);
      textCanvas.style.width = (W - pad * 2) + 'px';
      textCanvas.style.height = (H - pad * 2) + 'px';
      textCanvas.style.left = pad + 'px';
      textCanvas.style.top = pad + 'px';
      const fit = Math.min(W / gw, H / gh);
      let scale = Math.max(1, Math.floor(fit));
      // 小屏上整数倍缩放会浪费大半屏幕（如 256 像素宽的画面放进 340 像素），此时允许非整数缩放
      if (touch && fit < 2) scale = fit;
      const sw = Math.round(gw * scale), sh = Math.round(gh * scale);
      gfxCanvas.style.width = sw + 'px';
      gfxCanvas.style.height = sh + 'px';
      gfxCanvas.style.left = Math.floor((W - sw) / 2) + 'px';
      gfxCanvas.style.top = Math.floor((H - sh) / 2) + 'px';
      const src = m.display === 'text' ? textCanvas : gfxCanvas;
      glowCanvas.style.width = src.style.width;
      glowCanvas.style.height = src.style.height;
      glowCanvas.style.left = src.style.left;
      glowCanvas.style.top = src.style.top;
    }

    function onDisplayChange() {
      const text = m.display === 'text';
      textCanvas.hidden = !text;
      gfxCanvas.hidden = text;
      monitor.dataset.mode = m.display;
      m.term.dirty = true;
      updateControls();
    }
    m.onDisplayChange = onDisplayChange;

    // ---------------- 设置：主题、CRT ----------------
    const swatches = Array.from(document.querySelectorAll('.swatch'));
    function applySettings() {
      textRenderer.setTheme(m.settings.theme);
      document.body.dataset.theme = m.settings.theme;
      screen.style.background = DOS.THEMES[textRenderer.themeName].palette[0];
      monitor.classList.toggle('crt', !!m.settings.crt);
      for (const b of swatches) b.setAttribute('aria-pressed', String(b.dataset.theme === textRenderer.themeName));
      $('btn-crt').setAttribute('aria-checked', String(!!m.settings.crt));
      m.term.dirty = true;
      applyTouch();
    }
    m.onSettingsChange = applySettings;

    // 软键盘打开时（焦点在代理输入框）不要把焦点抢回显示器，否则键盘会收起
    const refocus = () => { if (document.activeElement !== $('kbd-proxy')) monitor.focus({ preventScroll: true }); };
    for (const b of swatches) b.addEventListener('click', () => { m.updateSettings({ theme: b.dataset.theme }); refocus(); });
    const toggleCrt = () => { m.updateSettings({ crt: !m.settings.crt }); refocus(); };
    $('btn-crt').addEventListener('click', toggleCrt);
    $('btn-degauss').addEventListener('click', toggleCrt);
    $('btn-power').addEventListener('click', () => root.location.reload());
    $('btn-auto').addEventListener('click', () => {
      if (DOS.MarioProgram.toggleAuto) DOS.MarioProgram.toggleAuto();
      refocus();
    });
    $('btn-help').addEventListener('click', () => { toggleHelp(); });
    $('btn-reset').addEventListener('click', () => {
      if (!root.confirm('Erase the virtual disks, settings and high score, then reboot?')) { refocus(); return; }
      try { for (const k of ['htmldos.fs.v1', 'htmldos.settings', 'htmldos.mario.hiscore']) storage && storage.removeItem(k); } catch (e) { /* 忽略 */ }
      root.location.reload();
    });
    $('help-close').addEventListener('click', () => toggleHelp(false));

    function toggleHelp(force) {
      const show = force === undefined ? help.hidden : force;
      help.hidden = !show;
      if (show) $('help-close').focus(); else refocus();
    }

    // ---------------- 指示灯与状态 HUD ----------------
    const leds = {};
    for (const el of document.querySelectorAll('.led')) leds[el.dataset.led] = el;
    const ledTimers = {};
    const flash = (name) => {
      leds[name].classList.add('on');
      clearTimeout(ledTimers[name]);
      ledTimers[name] = setTimeout(() => leds[name].classList.remove('on'), 140);
    };
    m.fs.onActivity = (drive) => flash(drive === 'A' ? 'fdd' : 'hdd');

    let caps = false;
    const trackCaps = (e) => { if (e.getModifierState) caps = e.getModifierState('CapsLock'); };
    root.addEventListener('keydown', trackCaps);
    root.addEventListener('keyup', trackCaps);

    const pad2 = (n) => String(n).padStart(2, '0');
    const setText = (id, text) => { const el = $(id); if (el.textContent !== text) el.textContent = text; };
    let gameShown = false, lastFreeCheck = 0;
    function updateHud() {
      const g = DOS.MarioProgram.current;
      setText('hud-mode', m.display === 'text' ? `TEXT ${m.term.cols}\u00D7${m.term.rows}`
        : m.display === 'gfxconsole' ? 'VGA 13h \u00B7 40\u00D725'
          : `VGA 13h \u00B7 ${m.gfx.width}\u00D7${m.gfx.height}`);
      let cwd = '';
      try { cwd = m.fs.getCwd(); } catch (e) { cwd = m.fs.curDrive + ':'; }
      setText('hud-path', cwd.length > 22 ? '\u2026' + cwd.slice(-21) : cwd);
      setText('hud-ins', m.input.insertMode ? 'INS' : 'OVR');
      $('hud-ins').classList.toggle('on', m.input.insertMode);
      $('hud-caps').classList.toggle('on', caps);
      const d = m.now();
      setText('hud-clock', `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`);
      if (Date.now() - lastFreeCheck > 1000) {
        lastFreeCheck = Date.now();
        const u = m.fs.usage('C');
        setText('hud-free', (u.free / 1048576).toFixed(1) + ' MB');
        $('hud-meter').style.width = Math.max(1, Math.round(u.used / u.total * 100)) + '%';
      }
      // MARIO 运行时显示游戏面板
      if (!!g !== gameShown) { gameShown = !!g; $('hud-game').classList.toggle('active', gameShown); layout(); }
      leds.auto.classList.toggle('on', !!(g && g.autopilot));
      if (g) {
        setText('hud-score', String(g.score).padStart(6, '0'));
        setText('hud-coins', pad2(g.coins));
        setText('hud-lives', g.lives <= 5 ? '\u2665'.repeat(Math.max(0, g.lives)) || '\u2013' : '\u2665 \u00D7' + g.lives);
        setText('hud-time', String(g.time).padStart(3, '0'));
        $('btn-auto').setAttribute('aria-checked', String(!!g.autopilot));
        const p = DOS.MarioProgram.pilot;
        setText('hud-ai', g.autopilot && p
          ? `A* ${p.stats.lastNodes} nodes \u00B7 ${p.stats.lastMs.toFixed(1)} ms\nplan ${p.plan.length} ticks \u00B7 ${p.stats.searches} searches`
          : 'A* idle \u2014 press P');
      }
    }
    setInterval(updateHud, 200);

    // ---------------- 全局热键 ----------------
    m.input.onAnyKey = () => DOS.Audio.unlock();
    m.input.onGlobalKey = (ev) => {
      if (ev.key === 'F12') { toggleHelp(); return true; }
      if (!help.hidden) {
        if (ev.key === 'Escape') { toggleHelp(false); return true; }
        return ev.key !== 'Tab'; // 面板打开时吞掉其余按键（Tab 用于焦点切换）
      }
      if (ev.shift && (ev.key === 'PageUp' || ev.key === 'PageDown') && m.input.mode === 'shell') {
        m.term.scrollView(ev.key === 'PageUp' ? m.term.rows - 1 : -(m.term.rows - 1));
        return true;
      }
      return false;
    };
    screen.addEventListener('wheel', (e) => {
      if (m.input.mode !== 'shell') return;
      e.preventDefault();
      m.term.scrollView(e.deltaY < 0 ? 3 : -3);
    }, { passive: false });
    monitor.addEventListener('pointerdown', (e) => {
      DOS.Audio.unlock();
      if (e.pointerType === 'mouse' || !touchOn()) refocus();
    });

    // ---------------- 触屏：软键盘、按键条、手柄、滑动回看 ----------------
    const proxy = $('kbd-proxy'), touchKeys = $('touch-keys'), gamepad = $('gamepad');
    m.input.attachTextProxy(proxy);
    const autoTouch = !!((root.matchMedia && root.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0);
    function touchOn() { return m.settings.touch === undefined ? autoTouch : !!m.settings.touch; }
    const vibrate = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* 不支持 */ } };
    const prevent = (e) => { if (e.cancelable) e.preventDefault(); };
    const openKeyboard = () => proxy.focus({ preventScroll: true });

    function applyTouch() {
      document.body.classList.toggle('touch', touchOn());
      $('btn-touch').setAttribute('aria-checked', String(touchOn()));
      updateControls();
    }
    function updateControls() {
      const gfx = m.display === 'gfx';
      touchKeys.classList.toggle('show', !gfx);
      gamepad.classList.toggle('show', gfx);
      document.body.classList.toggle('gaming', gfx);
      if (gfx && document.activeElement === proxy) proxy.blur(); // 进入游戏时收起软键盘
      if (!gfx) releaseAllPad();
      layout();
    }
    $('btn-touch').addEventListener('click', () => { m.updateSettings({ touch: !touchOn() }); refocus(); });
    // iOS 只在 touchend/click 中允许解锁音频
    document.addEventListener('touchend', () => DOS.Audio.unlock(), { passive: true });
    document.addEventListener('click', () => DOS.Audio.unlock());

    // 点按屏幕：自检时跳过，否则在命令行下弹出软键盘；上下滑动回看历史输出
    let touchY = null, swipeAcc = 0, swiped = false;
    screen.addEventListener('touchstart', (e) => {
      if (!touchOn()) return;
      touchY = e.touches[0].clientY; swipeAcc = 0; swiped = false;
    }, { passive: true });
    screen.addEventListener('touchmove', (e) => {
      if (!touchOn() || touchY === null || m.input.mode !== 'shell') return;
      const y = e.touches[0].clientY;
      swipeAcc += y - touchY;
      touchY = y;
      const step = Math.max(8, screen.offsetHeight / m.term.rows);
      while (Math.abs(swipeAcc) >= step) {
        m.term.scrollView(swipeAcc > 0 ? 1 : -1);
        swipeAcc -= Math.sign(swipeAcc) * step;
        swiped = true;
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    screen.addEventListener('touchend', (e) => {
      if (!touchOn()) return;
      touchY = null;
      // 取消随后的模拟鼠标事件：否则 mousedown 会把焦点移回显示器，软键盘随即收起
      if (e.cancelable) e.preventDefault();
      if (swiped) return;
      if (m.booting) { m.input.push(DOS.Input.key('Escape')); return; }
      if (m.input.mode === 'shell') { m.term.resetView(); openKeyboard(); }
    }, { passive: false });

    // 按键条：按下即发送（不抢焦点，软键盘保持打开）；方向键与退格按住连发
    for (const b of touchKeys.querySelectorAll('.tkey')) {
      b.addEventListener('touchstart', prevent, { passive: false });
      b.addEventListener('mousedown', prevent);
      let timer = null;
      const key = () => [b.dataset.code, b.dataset.key, { ctrl: !!b.dataset.ctrl }];
      const release = () => {
        clearTimeout(timer); clearInterval(timer); timer = null;
        if (!b.classList.contains('pressed')) return;
        b.classList.remove('pressed');
        if (b.dataset.code) { const [c, k, mods] = key(); m.input.virtualKey(c, k, false, mods); }
      };
      b.addEventListener('pointerdown', (e) => {
        if (e.cancelable) e.preventDefault();
        DOS.Audio.unlock();
        vibrate();
        b.classList.add('pressed');
        if (b.dataset.action === 'keyboard') { if (document.activeElement === proxy) proxy.blur(); else openKeyboard(); return; }
        if (b.dataset.type) { m.term.resetView(); m.input.feed(b.dataset.type + '{Enter}'); return; }
        const [c, k, mods] = key();
        const fire = () => m.input.virtualKey(c, k, true, mods);
        fire();
        if (b.dataset.repeat) timer = setTimeout(() => { timer = setInterval(fire, 70); }, 380);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, release);
    }

    // 手柄：多点触控，手指在按键间滑动会自动切换（例如从 ▶ 滑到 ◀ 转身）
    const heldBy = new Map();   // pointerId → 按钮
    const holdCount = new Map(); // 按钮 → 按住它的手指数
    const padPress = (btn) => {
      const n = (holdCount.get(btn) || 0) + 1;
      holdCount.set(btn, n);
      if (n === 1) { btn.classList.add('pressed'); vibrate(); m.input.virtualKey(btn.dataset.code, btn.dataset.key, true); }
    };
    const padRelease = (btn) => {
      const n = (holdCount.get(btn) || 0) - 1;
      if (n > 0) { holdCount.set(btn, n); return; }
      holdCount.delete(btn);
      btn.classList.remove('pressed');
      m.input.virtualKey(btn.dataset.code, btn.dataset.key, false);
    };
    function releaseAllPad() {
      for (const btn of holdCount.keys()) { btn.classList.remove('pressed'); m.input.virtualKey(btn.dataset.code, btn.dataset.key, false); }
      holdCount.clear();
      heldBy.clear();
    }
    const padTrack = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el && el.closest ? el.closest('#gamepad button[data-code]') : null;
      const prev = heldBy.get(e.pointerId);
      if (prev === btn) return;
      if (prev) padRelease(prev);
      if (btn) { padPress(btn); heldBy.set(e.pointerId, btn); } else heldBy.delete(e.pointerId);
    };
    const padEnd = (e) => { const b = heldBy.get(e.pointerId); if (b) padRelease(b); heldBy.delete(e.pointerId); };
    gamepad.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      DOS.Audio.unlock();
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      padTrack(e);
    });
    gamepad.addEventListener('pointermove', (e) => { if (heldBy.has(e.pointerId)) padTrack(e); });
    gamepad.addEventListener('pointerup', padEnd);
    gamepad.addEventListener('pointercancel', padEnd);
    gamepad.addEventListener('touchstart', prevent, { passive: false });
    gamepad.addEventListener('contextmenu', prevent);

    // ---------------- 渲染循环 ----------------
    let lastBlink = null;
    // 光晕：把画面缩到 1/4 分辨率，再由浏览器平滑放大，放大本身就是模糊；
    // 比在全尺寸图层上用 CSS blur() 便宜得多（软件渲染下也能保持 60fps）
    const copyGlow = (src) => {
      if (!m.settings.crt) return;
      const w = Math.max(1, Math.round(src.width / 4)), h = Math.max(1, Math.round(src.height / 4));
      if (glowCanvas.width !== w || glowCanvas.height !== h) { glowCanvas.width = w; glowCanvas.height = h; }
      glowCtx.imageSmoothingEnabled = true;
      glowCtx.drawImage(src, 0, 0, w, h);
    };
    m.gfx.onPresent = () => { if (m.display !== 'text') copyGlow(gfxCanvas); };
    function frame(t) {
      const blink = Math.floor(t / 270) % 2 === 0;
      if (m.display === 'text') {
        if (m.term.dirty || blink !== lastBlink) {
          textRenderer.render(m.term, blink);
          m.term.dirty = false;
          copyGlow(textCanvas);
        }
      } else if (m.display === 'gfxconsole') {
        if (m.term.dirty || blink !== lastBlink) {
          DOS.renderTerminalToGraphics(m.term, m.gfx, blink);
          m.term.dirty = false;
        }
      }
      lastBlink = blink;
      root.requestAnimationFrame(frame);
    }

    root.addEventListener('resize', layout);
    applySettings();
    updateHud();
    onDisplayChange();
    refocus();
    root.requestAnimationFrame(frame);
    m.boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
