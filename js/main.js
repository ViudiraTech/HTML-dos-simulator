/*
 * main.js —— 浏览器启动：DOM 连接、渲染循环、布局、工具栏、帮助面板、无障碍播报
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
      const bar = document.querySelector('.toolbar').offsetHeight;
      const availW = Math.min(root.innerWidth - 24, 1400);
      const availH = root.innerHeight - bar - 40;
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
    const themeNames = Object.keys(DOS.THEMES);
    function applySettings() {
      textRenderer.setTheme(m.settings.theme);
      document.body.dataset.theme = m.settings.theme;
      screen.style.background = DOS.THEMES[textRenderer.themeName].palette[0];
      monitor.classList.toggle('crt', !!m.settings.crt);
      $('btn-theme').textContent = 'Theme: ' + DOS.THEMES[textRenderer.themeName].name;
      $('btn-crt').textContent = 'CRT: ' + (m.settings.crt ? 'On' : 'Off');
      $('btn-crt').setAttribute('aria-pressed', String(!!m.settings.crt));
      m.term.dirty = true;
    }
    m.onSettingsChange = applySettings;

    const refocus = () => monitor.focus({ preventScroll: true });
    $('btn-theme').addEventListener('click', () => {
      const i = themeNames.indexOf(m.settings.theme);
      m.updateSettings({ theme: themeNames[(i + 1) % themeNames.length] });
      refocus();
    });
    $('btn-crt').addEventListener('click', () => { m.updateSettings({ crt: !m.settings.crt }); refocus(); });
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
    const copyGlow = (src) => {
      if (!m.settings.crt) return;
      if (glowCanvas.width !== src.width || glowCanvas.height !== src.height) { glowCanvas.width = src.width; glowCanvas.height = src.height; }
      glowCtx.drawImage(src, 0, 0);
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
    onDisplayChange();
    refocus();
    root.requestAnimationFrame(frame);
    m.boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
