// Procedural sound synthesizer using Web Audio API

class SoundManager {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playMoveClick() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch {
      // Audio error ignored
    }
  }

  public playQThrust() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(700, this.ctx.currentTime + 0.08);
      osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);

      // Noise layer for sword blade cut
      const bufferSize = this.ctx.sampleRate * 0.15;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1500, this.ctx.currentTime);
      filter.Q.setValueAtTime(3, this.ctx.currentTime);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      whiteNoise.start();
      osc.stop(this.ctx.currentTime + 0.22);
      whiteNoise.stop(this.ctx.currentTime + 0.15);
    } catch {
      // Audio error ignored
    }
  }

  public playQTornado() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const bufferSize = this.ctx.sampleRate * 0.8;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(2200, this.ctx.currentTime + 0.3);
      filter.frequency.exponentialRampToValueAtTime(500, this.ctx.currentTime + 0.8);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.35, this.ctx.currentTime + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.8);

      // Pitch sweep for "Hasagi" whistle
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(650, this.ctx.currentTime + 0.2);
      osc.frequency.exponentialRampToValueAtTime(260, this.ctx.currentTime + 0.6);

      oscGain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      oscGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.6);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);

      noise.start();
      osc.start();
      noise.stop(this.ctx.currentTime + 0.8);
      osc.stop(this.ctx.currentTime + 0.6);
    } catch {
      // Audio error ignored
    }
  }

  public playWindWall() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const bufferSize = this.ctx.sampleRate * 0.6;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, this.ctx.currentTime);
      filter.frequency.linearRampToValueAtTime(1400, this.ctx.currentTime + 0.3);
      filter.Q.setValueAtTime(4, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.6);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start();
      noise.stop(this.ctx.currentTime + 0.6);
    } catch {
      // Audio error ignored
    }
  }

  public playDash() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, this.ctx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    } catch {
      // Audio error ignored
    }
  }

  public playLastBreath() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      // Staccato slashes
      for (let i = 0; i < 4; i++) {
        const time = now + i * 0.14;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400 + i * 150, time);
        osc.frequency.exponentialRampToValueAtTime(120, time + 0.1);

        gain.gain.setValueAtTime(0.22, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(time);
        osc.stop(time + 0.12);
      }

      // Final crash impact at 0.7s
      const impactTime = now + 0.7;
      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();

      sub.type = 'triangle';
      sub.frequency.setValueAtTime(160, impactTime);
      sub.frequency.exponentialRampToValueAtTime(40, impactTime + 0.4);

      subGain.gain.setValueAtTime(0.4, impactTime);
      subGain.gain.exponentialRampToValueAtTime(0.001, impactTime + 0.45);

      sub.connect(subGain);
      subGain.connect(this.ctx.destination);

      sub.start(impactTime);
      sub.stop(impactTime + 0.45);
    } catch {
      // Audio error ignored
    }
  }

  public playHit() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(220, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    } catch {
      // Audio error ignored
    }
  }

  public playBlocked() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch {
      // Audio error ignored
    }
  }

  public playAirborne() {
    if (!this.enabled) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(520, this.ctx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch {
      // Audio error ignored
    }
  }
}

export const sound = new SoundManager();
