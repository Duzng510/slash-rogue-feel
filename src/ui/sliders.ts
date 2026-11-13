import { CONFIG, Settings } from "../config.ts";

/** graduated player-facing feel settings wired to the debug panel range inputs */
type SliderKey = keyof typeof CONFIG.SLIDERS | "timescale";
const SLIDERS: { id: string; label: string; key: SliderKey; fmt: (v: number) => string }[] = [
  { id: "s-shake", label: "v-shake", key: "shake", fmt: (v) => v.toFixed(2) },
  { id: "s-volume", label: "v-volume", key: "volume", fmt: (v) => v.toFixed(2) },
  { id: "s-particles", label: "v-particles", key: "particles", fmt: (v) => v.toFixed(2) },
  { id: "s-timescale", label: "v-timescale", key: "timescale", fmt: (v) => v.toFixed(2) },
  { id: "s-hitstop", label: "v-hitstop", key: "hitStopScale", fmt: (v) => `${v}` },
  { id: "s-dmgnum", label: "v-dmgnum", key: "dmgNumbers", fmt: (v) => (v > 0 ? "on" : "off") },
  { id: "s-bright", label: "v-bright", key: "brightness", fmt: (v) => v.toFixed(2) },
  { id: "s-bloom", label: "v-bloom", key: "bloom", fmt: (v) => v.toFixed(2) },
  { id: "s-crt", label: "v-crt", key: "crt", fmt: (v) => v.toFixed(2) },
  { id: "s-ripple", label: "v-ripple", key: "ripple", fmt: (v) => v.toFixed(2) },
  { id: "s-lighting", label: "v-lighting", key: "lighting", fmt: (v) => v.toFixed(2) },
];

export function syncSliderLabels(): void {
  for (const s of SLIDERS) {
    const input = document.getElementById(s.id) as HTMLInputElement | null;
    const out = document.getElementById(s.label) as HTMLElement | null;
    if (input === null || out === null) continue;
    const value = s.key === "timescale" ? Settings.timescale : CONFIG.SLIDERS[s.key];
    input.value = String(value);
    out.textContent = s.fmt(value);
  }
}

export function initSliders(): void {
  for (const s of SLIDERS) {
    const input = document.getElementById(s.id) as HTMLInputElement | null;
    if (input === null) continue;
    input.addEventListener("input", () => {
      if (s.key === "timescale") Settings.timescale = Number(input.value);
      else CONFIG.SLIDERS[s.key] = Number(input.value);
      syncSliderLabels();
    });
  }
  syncSliderLabels();
}
