import type { World } from "../world/world.ts";
import type { Sprite } from "../render/pixelart.ts";
import { WEAPONS, WEAPON_LIST, type WeaponId } from "../systems/weapons.ts";

export class WeaponSelect {
  private hovered: WeaponId | null = null;

  constructor(
    private readonly world: World,
    private readonly sprites: Record<string, Sprite>,
  ) {}

  isOpen(): boolean {
    return this.world.weaponChoices !== null && this.world.weaponChoices.length > 0;
  }

  open(): void {
    this.world.weaponChoices = [...WEAPON_LIST];
  }

  close(): void {
    this.world.weaponChoices = null;
  }

  handlePointer(x: number, y: number): WeaponId | null {
    if (!this.isOpen()) return null;
    const rx = 20;
    const rowW = 280;
    const rowH = 26;
    const rowGap = 3;
    const startY = 27;

    const list = this.world.weaponChoices ?? WEAPON_LIST;
    for (let i = 0; i < list.length; i++) {
      const ry = startY + i * (rowH + rowGap);
      if (x >= rx && x <= rx + rowW && y >= ry && y <= ry + rowH) {
        return list[i];
      }
    }
    return null;
  }

  updateHover(x: number, y: number): void {
    this.hovered = this.handlePointer(x, y);
  }

  draw(o: CanvasRenderingContext2D, scale: number): void {
    if (!this.isOpen()) return;
    const now = performance.now();

    o.save();
    o.scale(scale, scale);

    // Dark backdrop
    const bgGrad = o.createRadialGradient(160, 90, 20, 160, 90, 180);
    bgGrad.addColorStop(0, "rgba(12, 16, 26, 0.97)");
    bgGrad.addColorStop(1, "rgba(4, 6, 10, 0.99)");
    o.fillStyle = bgGrad;
    o.fillRect(0, 0, 320, 180);

    // Atmospheric magical motes
    for (let i = 0; i < 15; i++) {
      const px = (Math.sin(now * 0.0006 + i * 2.1) * 0.5 + 0.5) * 320;
      const py = (Math.cos(now * 0.0008 + i * 1.5) * 0.5 + 0.5) * 180;
      const pAlpha = 0.12 + 0.1 * Math.sin(now * 0.003 + i);
      o.fillStyle = `rgba(100, 220, 255, ${pAlpha})`;
      o.fillRect(Math.floor(px), Math.floor(py), 1.5, 1.5);
    }

    // Modal Header
    o.textBaseline = "top";
    o.textAlign = "center";
    o.shadowColor = "#00f0ff";
    o.shadowBlur = 6;
    o.fillStyle = "#ffffff";
    o.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    o.fillText("CHỌN VŨ KHÍ XUẤT TRẬN", 160, 6);
    o.shadowBlur = 0;

    o.font = "bold 6px sans-serif";
    o.fillStyle = "#7fd1ff";
    o.fillText("Bấm phím [1]-[5] hoặc chạm vào hàng vũ khí để chọn", 160, 19);

    const rx = 20;
    const rowW = 280;
    const rowH = 26;
    const rowGap = 3;
    const startY = 27;

    const list = this.world.weaponChoices ?? WEAPON_LIST;

    list.forEach((id, i) => {
      const w = WEAPONS[id];
      const ry = startY + i * (rowH + rowGap);
      const isHover = this.hovered === id;
      const won = this.world.achievements.weaponsWon.has(id);

      // Card Base
      o.fillStyle = isHover ? "rgba(22, 30, 48, 0.98)" : "rgba(14, 18, 28, 0.94)";
      o.fillRect(rx, ry, rowW, rowH);

      // Card Border with glow
      o.strokeStyle = won ? "#ffd166" : isHover ? "#ffffff" : w.color;
      o.lineWidth = isHover || won ? 1.2 : 0.8;
      o.strokeRect(rx + 0.5, ry + 0.5, rowW - 1, rowH - 1);

      // Left Accent bar
      o.fillStyle = w.color;
      o.fillRect(rx, ry, 3, rowH);

      // Hotkey badge [1]..[5]
      o.fillStyle = "#0a0d14";
      o.fillRect(rx + 6, ry + 4, 14, 18);
      o.strokeStyle = isHover ? "#ffffff" : w.color;
      o.lineWidth = 1;
      o.strokeRect(rx + 6.5, ry + 4.5, 13, 17);
      o.textAlign = "center";
      o.fillStyle = isHover ? "#ffd166" : "#ffffff";
      o.font = "bold 8px sans-serif";
      o.fillText(`${i + 1}`, rx + 13, ry + 8);

      // Weapon Icon Sprite
      const sp = this.sprites[w.sprite];
      if (sp) {
        o.drawImage(sp.c, rx + 24, ry + 5);
      }

      // Weapon Name
      o.textAlign = "left";
      o.font = "bold 8.5px sans-serif";
      o.fillStyle = w.color;
      o.fillText(w.name, rx + 44, ry + 4);

      // Victory badge if already won with this weapon
      if (won) {
        o.fillStyle = "#ffd166";
        o.font = "bold 5.5px sans-serif";
        o.fillText("✓ ĐÃ THẮNG", rx + 104, ry + 5.5);
      }

      // Weapon Description
      o.font = "6px sans-serif";
      o.fillStyle = "#b4c4d9";
      o.fillText(w.desc, rx + 44, ry + 15);

      // Stats Badges
      const cb0 = w.combos[0];
      const statsX = rx + 168;

      o.font = "bold 5.5px sans-serif";
      o.fillStyle = "#8ab4ff";
      o.fillText(`ST: ${cb0.dmg}`, statsX, ry + 5);
      o.fillText(`Tầm: ${cb0.reach}px`, statsX + 24, ry + 5);
      o.fillText(`Arc: ${cb0.deg}°`, statsX + 54, ry + 5);

      // Special weapon perks
      o.fillStyle = "#ffd166";
      let perk = `${w.combos.length} đòn`;
      if (w.critChance > 0) perk += ` · +${Math.round(w.critChance * 100)}% Crit`;
      else if (w.hitStopMult > 1) perk += ` · Khựng x${w.hitStopMult}`;
      else if (w.combos.length === 1) perk += ` · Đơn kích`;
      o.fillText(perk, statsX, ry + 15);

      // Dynamic Weapon Particle & Visual Effect in preview box
      const fx = rx + rowW - 46;
      const fy = ry + 2;
      const fw = 42;
      const fh = rowH - 4;

      o.save();
      o.beginPath();
      o.rect(fx, fy, fw, fh);
      o.clip();

      o.fillStyle = "rgba(8, 12, 18, 0.7)";
      o.fillRect(fx, fy, fw, fh);
      o.strokeStyle = "rgba(255, 255, 255, 0.1)";
      o.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);

      const t = now * 0.003;
      if (id === "katana") {
        // Swift cyan slash arc
        const wave = (t * 2) % 1;
        const sx = fx + wave * (fw + 10) - 5;
        o.strokeStyle = "#bfe8ff";
        o.lineWidth = 1.5;
        o.beginPath();
        o.moveTo(sx - 8, fy + fh - 3);
        o.quadraticCurveTo(sx, fy + fh / 2, sx + 8, fy + 3);
        o.stroke();
      } else if (id === "greatsword") {
        // Heavy vertical slam and impact sparks
        const drop = (t * 1.2) % 1;
        o.fillStyle = "#ffd166";
        for (let s = 0; s < 4; s++) {
          const sparkY = fy + drop * (fh - 4) + s * 3;
          if (sparkY < fy + fh) {
            o.fillRect(fx + 10 + s * 7, sparkY, 2, 2);
          }
        }
      } else if (id === "dagger") {
        // Fast dual glints
        const blink1 = Math.abs(Math.sin(t * 5));
        const blink2 = Math.abs(Math.cos(t * 5));
        o.fillStyle = `rgba(255, 209, 102, ${blink1})`;
        o.fillRect(fx + 12, fy + 9, 3, 3);
        o.fillStyle = `rgba(255, 255, 255, ${blink2})`;
        o.fillRect(fx + 26, fy + 12, 3, 3);
      } else if (id === "spear") {
        // High speed horizontal thrust
        const thrust = (t * 3) % 1;
        const px = fx + thrust * (fw - 8);
        o.strokeStyle = "#c8ff8a";
        o.lineWidth = 1.2;
        o.beginPath();
        o.moveTo(px - 10, fy + fh / 2);
        o.lineTo(px + 4, fy + fh / 2);
        o.stroke();
        o.fillStyle = "#ffffff";
        o.fillRect(px + 4, fy + fh / 2 - 1, 2, 2);
      } else if (id === "whip") {
        // Flowing crimson wave
        o.strokeStyle = "#e0455a";
        o.lineWidth = 1.2;
        o.beginPath();
        for (let px = 0; px <= fw; px += 2) {
          const py = fy + fh / 2 + Math.sin(t * 4 + px * 0.3) * 6;
          if (px === 0) o.moveTo(fx + px, py);
          else o.lineTo(fx + px, py);
        }
        o.stroke();
      }
      o.restore();
    });

    o.restore();
  }
}
