import { APP_VERSION, CHANGELOG } from "./changelog.ts";

/** release-notes popup: opens automatically only for a version the player hasn't seen yet */
const CHANGELOG_SEEN_KEY = "ruby.changelogSeen.v1";

export function initChangelog(): void {
  const modal = document.getElementById("changelog-modal") as HTMLDivElement;
  const body = document.getElementById("changelog-body") as HTMLDivElement;
  const closeBtn = document.getElementById("changelog-close") as HTMLButtonElement;
  const openBtn = document.getElementById("btn-changelog") as HTMLButtonElement;
  const versionEl = document.getElementById("version") as HTMLSpanElement;

  versionEl.textContent = APP_VERSION;
  body.innerHTML = CHANGELOG.map(
    (e) =>
      `<section class="mb-4">` +
      `<div class="flex items-baseline justify-between mb-1.5 pb-1 border-b border-[#233045]">` +
      `<span class="text-[12px] font-bold text-[#00f0ff]">${e.version}</span>` +
      `<span class="text-[10px] text-[#6b7d99]">${e.date}</span></div>` +
      `<ul class="list-none p-0 m-0">` +
      e.items
        .map((i) => `<li class="mb-1.5 relative pl-3.5 before:content-['⚡'] before:absolute before:left-0 before:text-[#00f0ff] before:text-[9px]">${i}</li>`)
        .join("") +
      `</ul></section>`
  ).join("");

  const open = (): void => {
    modal.hidden = false;
  };
  const close = (): void => {
    modal.hidden = true;
    try {
      localStorage.setItem(CHANGELOG_SEEN_KEY, APP_VERSION);
    } catch {
      /** private mode: the popup just reappears next load */
    }
  };
  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) close();
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !modal.hidden) close();
  });

  let seen: string | null = null;
  try {
    seen = localStorage.getItem(CHANGELOG_SEEN_KEY);
  } catch {
    seen = null;
  }
  if (seen !== APP_VERSION) open();
}
