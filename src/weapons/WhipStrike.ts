import { gameEvents } from '../core/EventBus';
import { LAYER_Y } from '../core/Constants';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';
import { WHIP_SPRITE_ASPECT } from '../render/SpriteLibraryPowerArt';

/**
 * WHIP STRIKE - FIXED HORIZONTAL SIDE -> BOTH SIDES.
 *
 * This weapon's direction is a CONSTANT. It always lashes toward world +X
 * ("right" on screen) at Lv1, and adds the mirrored -X lash at Lv2. Player
 * movement is not an input to it in any form:
 *
 *   - `ctx.playerVX` / `ctx.playerVZ` are never read.
 *   - there is no `facing`, `horizontalFacing` or `lastDirection` state.
 *   - walking up, down, left, right or diagonally changes nothing.
 *
 * Lv1 always:      P =====>
 * Lv2 onward:  <===== P =====>
 *
 * (The previous implementation flipped sides from `playerVX` past a deadzone,
 * which is exactly the movement dependency this weapon must not have.)
 *
 * HITBOX == ANIMATION. Each lash is one explicit rectangular band built by
 * `strikeBand()`, and the slash sprite for that lash is spawned centred on
 * that same band. There is no single "wide band" that damages both sides
 * while only one side animates: two lashes means two separate bands and two
 * separate sprites, so what you see hit is what got hit.
 */

const FIXED_SIDE = 1 as const; // +1 = world +X. A constant, never reassigned.
const SLASH_VISUAL_LIFE = 0.22;
/**
 * The mirrored Lv2 lash lands slightly after the primary one. Purely a
 * readability beat (the spec allows 40-80ms) - and because BOTH its damage
 * and its sprite are deferred together, the hitbox still matches the
 * animation exactly. Mechanically it is still one attack: one cooldown, one
 * `weaponFired` event.
 */
const BACK_LASH_DELAY = 0.06;
const EVOLVED_KNOCKBACK_DISTANCE = 0.9;
/**
 * World-space height of the wielder's hand, i.e. where the cord should leave
 * the body. The player sprite spans roughly y 0.02 .. 1.52, so this sits at
 * arm level rather than at the feet or over the head.
 */
/** Fallback when no character anchor is supplied (e.g. the default adventurer sprite). */
const DEFAULT_HAND_HEIGHT = 0.72;

interface PendingLash {
  at: number; // ctx.elapsed timestamp when this lash resolves
  side: 1 | -1;
  damage: number;
  reach: number;
  halfWidth: number;
}

export class WhipStrikeWeapon implements Weapon {
  readonly id = 'whip_strike';
  readonly name = 'Whip Strike';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  readonly handlesOwnHits = true;
  readonly evolutionRequiresPassive = 'passive_health';

  private readonly visualId: number;
  /** Evolved Serpent's Coil: venom-green lash. */
  private readonly evolvedVisualId: number;
  private cooldown = 0;
  private readonly hitBuffer: number[] = [];
  private readonly pending: PendingLash[] = [];
  /** Live slash sprites, kept anchored to the player for their short life (see anchorSlashes). */
  private readonly liveSlashes: Array<{ index: number; side: 1 | -1; reach: number; height: number }> = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('whip_slash', 1.9, [1, 1, 1], false);
    this.evolvedVisualId = visuals.get('whip_slash_evo', 1.9, [1, 1, 1], false);
  }

  /** World Y the cord should leave the body at, from the active character's own metadata. */
  private handHeight(ctx: WeaponContext): number {
    return ctx.castAnchorY > 0 ? ctx.castAnchorY : DEFAULT_HAND_HEIGHT;
  }

  /** How many horizontal sides this level strikes: 1 (fixed side) or 2 (both). */
  sideCount(): number {
    return effectAt(this.id, this.level, this.evolved).sides ?? 1;
  }

  update(ctx: WeaponContext): void {
    this.anchorSlashes(ctx);
    this.resolvePending(ctx);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;

    const e = effectAt(this.id, this.level, this.evolved);
    this.cooldown = e.cooldown * ctx.stats.cooldownMultiplier;

    const reach = (e.radius ?? 3.2) * ctx.stats.areaMultiplier;
    const halfWidth = (e.halfWidth ?? 1.15) * ctx.stats.areaMultiplier;
    const damage = e.damage * ctx.stats.damageMultiplier;

    // Primary lash: the fixed side, immediately.
    this.lash(ctx, FIXED_SIDE, damage, reach, halfWidth);

    // Lv2+ unlocks the mirrored lash, queued a beat later.
    if ((e.sides ?? 1) >= 2) {
      this.pending.push({ at: ctx.elapsed + BACK_LASH_DELAY, side: -FIXED_SIDE as -1, damage, reach, halfWidth });
    }

    gameEvents.emit('weaponFired', { weaponId: this.id, x: ctx.playerX, z: ctx.playerZ });
  }

  /**
   * A lash emanates from the wielder, so its sprite rides with the player for
   * its (very short) life instead of being left behind in world space as the
   * player walks on - which both looks detached and would break the
   * "animation sits exactly on the hitbox" guarantee, since the band is
   * always measured from the player's CURRENT position.
   */
  private anchorSlashes(ctx: WeaponContext): void {
    for (let i = this.liveSlashes.length - 1; i >= 0; i--) {
      const s = this.liveSlashes[i];
      if (!ctx.projectiles.alive[s.index]) {
        this.liveSlashes.splice(i, 1);
        continue;
      }
      ctx.projectiles.setPosition(s.index, ctx.playerX + s.side * s.reach * 0.5, ctx.playerZ);
      ctx.projectiles.setHeightOffset(s.index, this.handHeight(ctx) - s.height * 0.5 - LAYER_Y.projectile);
    }
  }

  private resolvePending(ctx: WeaponContext): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (ctx.elapsed < p.at) continue;
      this.lash(ctx, p.side, p.damage, p.reach, p.halfWidth);
      this.pending.splice(i, 1);
    }
  }

  /**
   * One lash on `side`: damages exactly the band described by
   * `strikeBand(side)` and spawns the slash sprite centred on that same band,
   * mirrored to match. Nothing outside the band is touched.
   */
  private lash(ctx: WeaponContext, side: 1 | -1, damage: number, reach: number, halfWidth: number): void {
    const band = strikeBand(ctx.playerX, ctx.playerZ, side, reach, halfWidth);

    // Query a circle that comfortably contains the band, then reject anything
    // outside the rectangle itself.
    const queryRadius = Math.sqrt(reach * reach + halfWidth * halfWidth);
    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, queryRadius, this.hitBuffer);
    for (let i = 0; i < count; i++) {
      const enemyIndex = this.hitBuffer[i];
      const ex = ctx.enemies.posX[enemyIndex];
      const ez = ctx.enemies.posZ[enemyIndex];
      if (ex < band.minX || ex > band.maxX || ez < band.minZ || ez > band.maxZ) continue;
      const crit = ctx.rng() < ctx.stats.critChance;
      const dmg = damage * (crit ? ctx.stats.critMultiplier : 1);
      ctx.enemies.damage(enemyIndex, dmg, crit, this.id);
      if (this.evolved) {
        const dx = ex - ctx.playerX;
        const dz = ez - ctx.playerZ;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        ctx.enemies.posX[enemyIndex] += (dx / dist) * EVOLVED_KNOCKBACK_DISTANCE;
        ctx.enemies.posZ[enemyIndex] += (dz / dist) * EVOLVED_KNOCKBACK_DISTANCE;
      }
    }

    // Slash sprite centred on the band it just damaged, mirrored per side.
    const index = ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX + side * reach * 0.5, ctx.playerZ, 0, 0, {
      damage: 0,
      radius: 0,
      pierce: 0,
      life: SLASH_VISUAL_LIFE,
      weaponId: this.weaponNumericId,
    });
    if (index !== -1) {
      // LONG AND THIN, not square. setSize() drives both axes, so the old call
      // made a 3.4-unit-long lash also 3.4 units TALL; with the quad anchored
      // at its bottom edge that pushed the drawn cord about 0.6 units above
      // the player's head. Width tracks the band's real length so the lash
      // grows with `reach`; height follows the sprite's authored aspect so the
      // cord stays proportionally thin at every level.
      const width = reach * 1.05;
      const height = width / WHIP_SPRITE_ASPECT;
      ctx.projectiles.setSizeXY(index, width, height);
      ctx.projectiles.setFacing(index, side);
      // The lash art is centred vertically in its cell, so the cord renders at
      // (quad bottom + height/2). Offsetting by that much below HAND_HEIGHT
      // puts the cord level with the wielder's hand instead of over their head.
      ctx.projectiles.setHeightOffset(index, this.handHeight(ctx) - height * 0.5 - LAYER_Y.projectile);
      this.liveSlashes.push({ index, side, reach, height });
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}

/**
 * The exact rectangle one lash damages, in world space. Exported so tests
 * (and the debug showcase) can assert the hitbox directly rather than
 * inferring it from which enemies happened to die.
 */
export function strikeBand(
  playerX: number,
  playerZ: number,
  side: 1 | -1,
  reach: number,
  halfWidth: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const nearX = playerX;
  const farX = playerX + side * reach;
  return {
    minX: Math.min(nearX, farX),
    maxX: Math.max(nearX, farX),
    minZ: playerZ - halfWidth,
    maxZ: playerZ + halfWidth,
  };
}
