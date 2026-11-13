/** Greedy word wrapping shared by the card-based HUD overlays. */
export function wrapCardLines(o: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && o.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}
