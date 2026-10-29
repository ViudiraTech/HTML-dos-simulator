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
    function layout() {
      // 预留顶栏、显示器下巴（指示灯一栏）、状态 HUD 与边距
      const bar = document.querySelector('.topbar').offsetHeight;
      const chin = document.querySelector('.chin').offsetHeight;
      const hud = $('hud').offsetHeight;
      const availW = Math.min(root.innerWidth - 64, 1400);
      const availH = root.innerHeight - bar - chin - hud - 96;
      let W = Math.max(640, Math.min(availW, availH * 4 / 3));
      W = Math.floor(W);
      const H = Math.floor(W * 3 / 4);
      screen.style.width = W + 'px';
      screen.style.height = H + 'px';
      // 文本模式留出少量“过扫描”黑边，避免首列字符贴住圆角显像管边缘
      const pad = Math.round(W * 0.025);
      textCanvas.style.width = (W - pad * 2) + 'px';
      textCanvas.style.height = (H - pad * 2) + 'px';
      textCanvas.style.left = pad + 'px';
      textCanvas.style.top = pad + 'px';
      const gw = m.gfx.width, gh = m.gfx.height;
      const scale = Math.max(1, Math.floor(Math.min(W / gw, H / gh)));
      gfxCanvas.style.width = gw * scale + 'px';
      gfxCanvas.style.height = gh * scale + 'px';
      gfxCanvas.style.left = Math.floor((W - gw * scale) / 2) + 'px';
      gfxCanvas.style.top = Math.floor((H - gh * scale) / 2) + 'px';
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
      layout();
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
    }
    m.onSettingsChange = applySettings;

    const refocus = () => monitor.focus({ preventScroll: true });
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
    monitor.addEventListener('pointerdown', () => { DOS.Audio.unlock(); refocus(); });

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
