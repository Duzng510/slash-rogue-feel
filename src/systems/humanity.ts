import { CONFIG } from "../config.ts";
import { clamp } from "../mathx.ts";

export function humanityErosion(humanity: number): number {
  const max = CONFIG.LAWS.HUMANITY_MAX;
  return 1 - clamp(humanity, 0, max) / max;
}

export function humanityAudioPitch(humanity: number, pitch: number): number {
  return pitch * (1 - humanityErosion(humanity) * CONFIG.LAWS.HUMANITY_AUDIO_PITCH_SHIFT);
}
