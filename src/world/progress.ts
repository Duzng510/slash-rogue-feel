import { CONFIG } from "../config.ts";
import { shuffle } from "../mathx.ts";
import { sfx } from "../events.ts";
import { ARTIFACTS } from "../systems/artifacts.ts";
import { checkAchievements } from "../systems/unlocks.ts";
import type { World } from "./world.ts";

/** Advances room rewards, completion conditions, and door/exit progression. */
export function progressWorld(world: World): void {
  if (world.player.dead) {
    world.playerDeadTicks++;
    if (world.pendingEnd === null && world.playerDeadTicks >= CONFIG.ROOMS.END_DELAY) {
      world.endRun();
      world.pendingEnd = "dead";
    }
    return;
  }

  if (world.room.kind === "rest") {
    world.room.openDoors();
    const centerX = world.room.widthPx / 2;
    const centerY = world.room.heightPx / 2;
    if (!world.restUsed && world.roomChoices === null && Math.hypot(world.player.x - centerX, world.player.y - centerY) <= CONFIG.ROOMS.CAMPFIRE_RADIUS) {
      world.roomChoices = {
        title: "LỬA TRẠI",
        subtitle: "Chọn một cách chuẩn bị cho chặng tiếp theo",
        choices: [
          { id: "rest", label: "NGHỈ", detail: "+2 HP" },
          { id: "forge", label: "RÈN", detail: world.player.weaponDamageBonus < CONFIG.ROOMS.FORGE_CAP ? `+1 sát thương (${world.player.weaponDamageBonus}/${CONFIG.ROOMS.FORGE_CAP})` : `Đã đạt tối đa +${CONFIG.ROOMS.FORGE_CAP}`, disabled: world.player.weaponDamageBonus >= CONFIG.ROOMS.FORGE_CAP },
        ],
      };
    }
  } else if (world.room.kind === "event") {
    if (!world.rewardedRooms.has(world.roomIndex) && world.roomChoices === null && world.curseOffer === null && world.artifactChoices.length === 0) {
      world.eventKind = world.artifactRng.next() < 0.5 ? "well" : "altar";
      const artifacts = world.availableArtifacts();
      const curses = world.availableCurses();
      if (world.eventKind === "well") {
        world.roomChoices = {
          title: "CÁI GIẾNG CỔ",
          subtitle: "Tiếng vọng dưới đáy giếng hứa hẹn một món quà",
          choices: [
            { id: "drink", label: "UỐNG", detail: "50% +2 HP · 50% -1 HP" },
            { id: "gold", label: `NÉM ${CONFIG.ROOMS.WELL_COST} VÀNG`, detail: "Nhận 1 cổ vật ngẫu nhiên", disabled: world.runStats.gold < CONFIG.ROOMS.WELL_COST || artifacts.length === 0 },
            { id: "leave", label: "BỎ ĐI", detail: "Rời khỏi giếng" },
          ],
        };
      } else {
        world.roomChoices = {
          title: "BÀN THỜ MÁU",
          subtitle: "Một lời khấn đổi lấy sức mạnh",
          choices: [
            { id: "sacrifice", label: `HIẾN ${CONFIG.ROOMS.SACRIFICE_HP} HP`, detail: "+1 HP tối đa", disabled: world.player.hp <= CONFIG.ROOMS.SACRIFICE_HP },
            { id: "prayer", label: "CẦU NGUYỆN", detail: "+2 cổ vật, nhận 1 nguyền rủa", disabled: curses.length === 0 || world.curses.size >= CONFIG.CURSES.MAX_CURSES || artifacts.length < 2 },
            { id: "leave", label: "BỎ ĐI", detail: "Rời khỏi bàn thờ" },
          ],
        };
      }
    }
  } else if (world.room.kind === "shrine") {
    if (!world.rewardedRooms.has(world.roomIndex) && world.curseOffer === null && world.artifactChoices.length === 0) {
      const rare = (["glasscannon", "phantom_dash"] as const)
        .map((id) => ARTIFACTS.find((artifact) => artifact.id === id)!)
        .filter((artifact) => !world.artifacts.has(artifact.id));
      const curses = world.availableCurses();
      if (rare.length > 0 && curses.length > 0 && world.curses.size < CONFIG.CURSES.MAX_CURSES) {
        shuffle(rare, world.artifactRng.next);
        shuffle(curses, world.artifactRng.next);
        world.artifactChoices = [rare[0]!];
        world.curseOffer = { artifacts: world.artifactChoices.slice(), curses: [curses[0]!] };
        world.curseTab = true;
      } else {
        world.rewardedRooms.add(world.roomIndex);
        world.room.openDoors();
      }
    }
  } else if (world.room.kind === "challenge" && world.aliveEnemies() === 0 && !world.room.doorOpen) {
    if (world.challengeWave < CONFIG.ROOMS.CHALLENGE_WAVES) {
      if (world.challengeBreakTicks < 0) {
        world.challengeBreakTicks = CONFIG.ROOMS.CHALLENGE_BREAK_TICKS;
        world.banner(`ĐỢT ${world.challengeWave}/${CONFIG.ROOMS.CHALLENGE_WAVES} HOÀN THÀNH`);
      } else if (--world.challengeBreakTicks <= 0) {
        world.challengeWave++;
        world.challengeBreakTicks = -1;
        world.spawnChallengeWave();
      }
      return;
    } else if (!world.rewardedRooms.has(world.roomIndex)) {
      world.artifactChoices = (["glasscannon", "phantom_dash"] as const)
        .filter((id) => !world.artifacts.has(id))
        .map((id) => ARTIFACTS.find((artifact) => artifact.id === id)!);
      if (world.artifactChoices.length > 0) return;
      world.rewardedRooms.add(world.roomIndex);
    }
    if (world.challengeWave >= CONFIG.ROOMS.CHALLENGE_WAVES && !world.rewardedRooms.has(world.roomIndex)) return;
    if (world.challengeWave >= CONFIG.ROOMS.CHALLENGE_WAVES && world.artifactChoices.length > 0) return;
    world.room.openDoors();
    sfx(world.queue, "door");
    world.banner("THỬ THÁCH HOÀN TẤT — cửa mở");
  } else if (world.room.kind === "shop") {
    if (!world.room.doorOpen) {
      world.room.openDoors();
      sfx(world.queue, "door");
    }
    if (!world.rewardedRooms.has(world.roomIndex)) {
      world.rewardedRooms.add(world.roomIndex);
      world.shopOffers = world.buildShopOffers();
    }
  } else if (world.aliveEnemies() === 0 && !world.room.doorOpen) {
    if (!world.rewardedRooms.has(world.roomIndex)) {
      const pool = world.availableArtifacts();
      shuffle(pool, world.artifactRng.next);
      const choiceCount = world.room.kind === "treasure" || world.room.kind === "elite" ? 3 : CONFIG.ASCENSION.artifactChoices;
      world.artifactChoices = pool.slice(0, choiceCount);
      const treasureCurses = world.room.kind === "treasure";
      const cursePool = treasureCurses
        ? world.availableCurses()
        : world.runStats.roomsCleared > 0 && world.runStats.roomsCleared % CONFIG.CURSES.OFFER_EVERY === 0
          ? world.availableCurses()
          : [];
      if (cursePool.length > 0 && world.curses.size < CONFIG.CURSES.MAX_CURSES &&
        (treasureCurses || pool.length >= 5)) {
        shuffle(cursePool, world.artifactRng.next);
        const bundle = treasureCurses ? world.artifactChoices.slice(0, 2) : pool.slice(3, 5);
        if (bundle.length === 2) world.curseOffer = { artifacts: bundle, curses: cursePool.slice(0, treasureCurses ? 1 : 2) };
      }
      if (world.artifactChoices.length > 0) return;
    }
    world.room.openDoors();
    sfx(world.queue, "door");
    world.banner(world.roomIndex === world.roomTotal - 1 ? "Sạch quái — hết prototype" : "Sạch quái — cửa mở");
  }

  if (world.room.exitsAt(world.player.x, world.player.y)) {
    const last = world.roomIndex === world.roomTotal - 1;
    world.runStats.roomsCleared++;
    sfx(world.queue, "door", 0.8, 1.2);
    if (last) {
      world.victory = true;
      world.endRun();
      world.awardAchievements(checkAchievements(world.runStats, "win"));
      if (world.ascensionLevel >= 1) world.awardAchievements(["ascension_1"]);
      if (world.ascensionLevel >= 4) world.awardAchievements(["ascension_4"]);
      if (world.ascensionLevel >= 8) world.awardAchievements(["ascension_8"]);
      if (world.ascensionLevel === world.achievements.ascensionMax && world.achievements.ascensionMax < 8) {
        world.achievements.ascensionMax = (world.achievements.ascensionMax + 1) as World["ascensionLevel"];
      }
      world.saveBestRun();
      world.pendingEnd = "won";
      world.banner("Thắng!");
      return;
    }
    world.loadRoom(world.roomIndex + 1);
  }
}
