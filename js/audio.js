/*
 * Audio —— Web Audio 合成：BEEP、马里奥音效与背景音乐
 * ---------------------------------------------------------------
 * - AudioContext 只在用户首次按键/点击后创建（浏览器自动播放限制）。
 * - 音效由“音符/滑音/噪声”片段表驱动，全部为原创参数。
 * - 音乐：方波主旋律 + 方波和声 + 三角波低音，音符序列见 MarioData.music。
 * - 在 Node（无 AudioContext）中所有方法均为空操作，便于测试。
 */
(function (root) {
  'use strict';
  const DOS = root.DOS = root.DOS || {};

  const NOTE_INDEX = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };

  /**
   * 音名转频率，如 "A4" → 440，"C#5"。
   * @param {string} name
   * @returns {number}
   */
  function noteFreq(name) {
    const m = /^([A-Ga-g][#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    const idx = NOTE_INDEX[m[1].toUpperCase()];
    const midi = (+m[2] + 1) * 12 + idx;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** 音效表：每个片段 [波形, 起始频率/音名, 结束频率, 时长秒, 音量] 顺序播放；'noise' 为噪声 */
  const SFX = {
    jump: [['square', 260, 720, 0.16, 0.18]],
    jumpBig: [['square', 200, 560, 0.18, 0.18]],
    stomp: [['square', 520, 180, 0.07, 0.22], ['square', 360, 120, 0.06, 0.18]],
    coin: [['square', 'C6', 'C6', 0.06, 0.15], ['square', 'G6', 'G6', 0.34, 0.13, 'decay']],
    bump: [['triangle', 140, 70, 0.08, 0.4], ['square', 90, 60, 0.05, 0.12]],
    break: [['noise', 0, 0, 0.18, 0.35], ['square', 180, 60, 0.12, 0.15]],
    sprout: [['square', 'G4', 'G4', 0.04, 0.14], ['square', 'B4', 'B4', 0.04, 0.14], ['square', 'D5', 'D5', 0.04, 0.14], ['square', 'G5', 'G5', 0.04, 0.14], ['square', 'A4', 'A4', 0.04, 0.14], ['square', 'C#5', 'C#5', 0.04, 0.14], ['square', 'E5', 'E5', 0.04, 0.14], ['square', 'A5', 'A5', 0.06, 0.14]],
    powerup: [['square', 'C5', 'C5', 0.05, 0.15], ['square', 'G4', 'G4', 0.05, 0.15], ['square', 'C5', 'C5', 0.05, 0.15], ['square', 'E5', 'E5', 0.05, 0.15], ['square', 'G5', 'G5', 0.05, 0.15], ['square', 'C6', 'C6', 0.05, 0.15], ['square', 'G5', 'G5', 0.05, 0.15], ['square', 'D5', 'D5', 0.05, 0.15], ['square', 'F#5', 'F#5', 0.05, 0.15], ['square', 'A5', 'A5', 0.05, 0.15], ['square', 'D6', 'D6', 0.08, 0.15]],
    oneup: [['square', 'C6', 'C6', 0.08, 0.13], ['square', 'E6', 'E6', 0.08, 0.13], ['square', 'G6', 'G6', 0.08, 0.12], ['square', 'C7', 'C7', 0.08, 0.11], ['square', 'G6', 'G6', 0.08, 0.11], ['square', 'C7', 'C7', 0.16, 0.1, 'decay']],
    pipe: [['square', 300, 110, 0.12, 0.2], ['silence', 0, 0, 0.04, 0], ['square', 300, 110, 0.12, 0.2], ['silence', 0, 0, 0.04, 0], ['square', 300, 110, 0.12, 0.2]],
    kick: [['square', 700, 400, 0.05, 0.2]],
    pause: [['square', 'G5', 'G5', 0.07, 0.12], ['square', 'D6', 'D6', 0.07, 0.12], ['square', 'G6', 'G6', 0.14, 0.12, 'decay']],
    flagpole: [['square', 1100, 260, 0.9, 0.12]],
    fireball: [['square', 600, 300, 0.04, 0.15]],
    tick: [['square', 'A6', 'A6', 0.025, 0.06]],
    warning: [['square', 'G5', 'G5', 0.08, 0.12], ['square', 'C6', 'C6', 0.08, 0.12], ['square', 'G5', 'G5', 0.08, 0.12], ['square', 'C6', 'C6', 0.12, 0.12]]
  };

  /** 旋律式短乐句（音名 + 拍长，tempo 拍/分） */
  const JINGLES = {
    death: { tempo: 180, notes: [['E5', 0.5], ['D#5', 0.5], ['D5', 0.5], ['C#5', 1.5], ['R', 0.5], ['C5', 0.5], ['A4', 0.5], ['F4', 0.5], ['D4', 0.5], ['C4', 2]] },
    clear: { tempo: 200, notes: [['C5', 0.5], ['E5', 0.5], ['G5', 0.5], ['C6', 1], ['A5', 0.5], ['F5', 0.5], ['D5', 0.5], ['B5', 1], ['G5', 0.5], ['C6', 0.5], ['E6', 0.5], ['D6', 0.5], ['B5', 0.5], ['C6', 3]] },
    gameover: { tempo: 140, notes: [['G4', 0.75], ['E4', 0.75], ['C4', 0.75], ['R', 0.25], ['D4', 0.5], ['E4', 0.5], ['D4', 0.5], ['B3', 0.5], ['C4', 2.5]] }
  };

  const Audio = {
    ctx: null,
    master: null,
    musicGain: null,
    sfxGain: null,
    noiseBuffer: null,
    musicTimer: null,
    musicState: null,
    muted: false,

    /** 是否可用 */
    available() { return typeof root.AudioContext !== 'undefined' || typeof root.webkitAudioContext !== 'undefined'; },

    /** 在用户手势中调用：创建/恢复 AudioContext */
    unlock() {
      if (!this.available()) return;
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        try { this.ctx = new AC(); } catch (e) { return; }
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.55;
        this.musicGain.connect(this.master);
        const len = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    /** 音频是否已就绪 */
    ready() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; },

    /**
     * 播放一个音（可滑音）。
     * @param {{type?:string, freq:number, to?:number, start?:number, dur:number, vol?:number, dest?:AudioNode, decay?:boolean}} o
     */
    tone(o) {
      if (!this.ready()) return;
      const ctx = this.ctx;
      const t0 = o.start || ctx.currentTime;
      const g = ctx.createGain();
      const vol = o.vol === undefined ? 0.2 : o.vol;
      g.gain.setValueAtTime(vol, t0);
      if (o.decay) g.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur);
      else { g.gain.setValueAtTime(vol, t0 + o.dur * 0.85); g.gain.linearRampToValueAtTime(0, t0 + o.dur); }
      g.connect(o.dest || this.sfxGain);
      let src;
      if (o.type === 'noise') {
        src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
      } else {
        src = ctx.createOscillator();
        src.type = o.type || 'square';
        src.frequency.setValueAtTime(o.freq, t0);
        if (o.to && o.to !== o.freq) src.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
      }
      src.connect(g);
      src.start(t0);
      src.stop(t0 + o.dur + 0.02);
      return src;
    },

    /**
     * PC 喇叭蜂鸣（方波）。
     * @param {number} [freq=800]
     * @param {number} [ms=200]
     */
    beep(freq = 800, ms = 200) {
      this.tone({ type: 'square', freq, dur: ms / 1000, vol: 0.15 });
    },

    /**
     * 播放命名音效。
     * @param {string} name SFX 或 JINGLES 中的键
     */
    sfx(name) {
      if (!this.ready()) return;
      if (JINGLES[name]) { this.jingle(name); return; }
      const parts = SFX[name];
      if (!parts) return;
      let t = this.ctx.currentTime + 0.005;
      for (const [type, a, b, dur, vol, mode] of parts) {
        if (type !== 'silence') {
          const f0 = typeof a === 'string' ? noteFreq(a) : a;
          const f1 = typeof b === 'string' ? noteFreq(b) : b;
          this.tone({ type, freq: f0, to: f1, start: t, dur, vol, decay: mode === 'decay' });
        }
        t += dur;
      }
    },

    /** 播放乐句 */
    jingle(name) {
      const j = JINGLES[name];
      if (!j || !this.ready()) return;
      const beat = 60 / j.tempo;
      let t = this.ctx.currentTime + 0.02;
      for (const [n, len] of j.notes) {
        const dur = len * beat;
        if (n !== 'R') {
          this.tone({ type: 'square', freq: noteFreq(n), start: t, dur: dur * 0.9, vol: 0.13 });
          this.tone({ type: 'triangle', freq: noteFreq(n) / 2, start: t, dur: dur * 0.9, vol: 0.25 });
        }
        t += dur;
      }
    },

    /**
     * 播放循环音乐。
     * @param {{tempo:number, step:number, tracks:{wave:string, vol:number, notes:string}[]}} song
     * @param {{speed?:number}} [opts]
     */
    playMusic(song, opts = {}) {
      this.stopMusic();
      if (!this.ctx || !song) return;
      // 把 "C5 - . E5" 形式的字符串解析为 [频率, 持续步数]
      const tracks = song.tracks.map(tr => {
        const toks = tr.notes.trim().split(/\s+/);
        const events = [];
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i];
          if (t === '-' || t === '.') continue;
          let len = 1;
          while (toks[i + len] === '-') len++;
          events.push({ step: i, len, freq: noteFreq(t) });
        }
        return { wave: tr.wave, vol: tr.vol, events, length: toks.length };
      });
      const length = Math.max.apply(null, tracks.map(t => t.length));
      const st = { song, tracks, length, step: 0, speed: opts.speed || 1, nextTime: this.ctx.currentTime + 0.1, paused: false };
      this.musicState = st;
      const tick = () => {
        if (!this.ctx || this.musicState !== st) return;
        const stepDur = 60 / (song.tempo * st.speed) / song.step;
        while (!st.paused && st.nextTime < this.ctx.currentTime + 0.15) {
          if (this.ready()) {
            for (const tr of tracks) {
              for (const ev of tr.events) {
                if (ev.step === st.step % tr.length) {
                  this.tone({ type: tr.wave, freq: ev.freq, start: st.nextTime, dur: ev.len * stepDur * 0.92, vol: tr.vol, dest: this.musicGain });
                }
              }
            }
          }
          st.nextTime += stepDur;
          st.step = (st.step + 1) % length;
        }
        if (st.paused) st.nextTime = this.ctx.currentTime + 0.05;
      };
      tick();
      this.musicTimer = setInterval(tick, 25);
    },

    /** 调整音乐速度（时间不足时加速） */
    setMusicSpeed(speed) { if (this.musicState) this.musicState.speed = speed; },

    /** 暂停/继续音乐 */
    pauseMusic(p) { if (this.musicState) this.musicState.paused = p; },

    /** 停止音乐 */
    stopMusic() {
      if (this.musicTimer) clearInterval(this.musicTimer);
      this.musicTimer = null;
      this.musicState = null;
    }
  };

  Audio.noteFreq = noteFreq;
  Audio.SFX = SFX;
  Audio.JINGLES = JINGLES;
  DOS.Audio = Audio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
