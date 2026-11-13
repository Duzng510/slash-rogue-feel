import { CONFIG } from "../config.ts";
import type { SfxName } from "../events.ts";

type Recipe = { dur: number; type: "noise" | "tone"; f0: number; f1: number; gain: number; filter?: number };

const RECIPES: Record<SfxName, Recipe> = {
  slash_air: { dur: 0.07, type: "noise", f0: 2600, f1: 900, gain: 0.32, filter: 1800 },
  slash_hit: { dur: 0.05, type: "noise", f0: 3600, f1: 1200, gain: 0.55, filter: 2400 },
  slash_hit_heavy: { dur: 0.09, type: "noise", f0: 2200, f1: 500, gain: 0.6, filter: 1200 },
  kill: { dur: 0.16, type: "tone", f0: 190, f1: 48, gain: 0.5 },
  hurt: { dur: 0.16, type: "tone", f0: 150, f1: 52, gain: 0.6 },
  dash: { dur: 0.1, type: "noise", f0: 500, f1: 2400, gain: 0.28, filter: 1400 },
  door: { dur: 0.22, type: "tone", f0: 520, f1: 880, gain: 0.3 },
  death: { dur: 0.5, type: "tone", f0: 220, f1: 40, gain: 0.55 },
  telegraph: { dur: 0.06, type: "tone", f0: 880, f1: 660, gain: 0.16 },
  burn_tick: { dur: 0.08, type: "noise", f0: 900, f1: 280, gain: 0.12, filter: 600 },
  shock_hit: { dur: 0.09, type: "tone", f0: 1400, f1: 380, gain: 0.3 },
  aftershock_boom: { dur: 0.28, type: "tone", f0: 120, f1: 40, gain: 0.5 },
  pursuit_proc: { dur: 0.07, type: "tone", f0: 620, f1: 1050, gain: 0.2 },
  reprisal_ready: { dur: 0.16, type: "tone", f0: 500, f1: 960, gain: 0.24 },
  shoot: { dur: 0.06, type: "noise", f0: 1800, f1: 700, gain: 0.24, filter: 1400 },
  teleport: { dur: 0.14, type: "tone", f0: 300, f1: 900, gain: 0.24 },
  town_bell: { dur: 1.2, type: "tone", f0: 660, f1: 440, gain: 0.08 },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlayTime: Partial<Record<SfxName, number>> = {};
  private voices = 0;

  /** browsers refuse audio until a gesture; call from a click/keydown */
  unlock(): void {
    if (this.ctx === null) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return;
      this.ctx = new Ctor();
      const len = Math.floor(this.ctx.sampleRate * 0.2);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(name: SfxName, gainMul = 1, pitchMul = 1): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== "running") return;
    const vol = CONFIG.SLIDERS.volume;
    if (vol <= 0.001) return;

    const t = ctx.currentTime;

    // D3: Audio clutter throttling cho các hiệu ứng lặp dày
    const minInterval: Partial<Record<SfxName, number>> = {
      telegraph: 0.12,
      burn_tick: 0.18,
      pursuit_proc: 0.25,
      teleport: 0.15,
      town_bell: 5,
    };
    const interval = minInterval[name];
    if (interval !== undefined) {
      const last = this.lastPlayTime[name] ?? -1;
      if (t - last < interval) return;
      this.lastPlayTime[name] = t;
    }

    const r = RECIPES[name];
    if (this.voices >= CONFIG.AUDIO.MAX_VOICES) return;
    this.voices++;
    const releaseVoice = (): void => {
      this.voices = Math.max(0, this.voices - 1);
    };
    const out = ctx.createGain();
    out.gain.setValueAtTime(r.gain * gainMul * vol * CONFIG.AUDIO.MASTER * 2, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + r.dur);
    out.connect(ctx.destination);

    if (r.type === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = pitchMul;
      src.onended = releaseVoice;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(r.f0 * pitchMul, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(60, r.f1 * pitchMul), t + r.dur);
      src.connect(bp);
      if (r.filter !== undefined) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.setValueAtTime(r.filter * pitchMul, t);
        bp.connect(lowpass);
        lowpass.connect(out);
      } else {
        bp.connect(out);
      }
      src.start(t);
      src.stop(t + r.dur);
    } else {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.onended = releaseVoice;
      osc.frequency.setValueAtTime(r.f0 * pitchMul, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, r.f1 * pitchMul), t + r.dur);
      osc.connect(out);
      osc.start(t);
      osc.stop(t + r.dur);
    }
  }
}
