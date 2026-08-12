import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_COOLDOWN = 1.0;
const BASE_DAMAGE = 10;
const BASE_REACH = 3.2; // half-length of the band along X (the horizontal facing axis), both directions
const BASE_HALF_WIDTH = 1.15; // half-extent of the band along Z (fixed vertical thickness, never rotates)
const SLASH_VISUAL_LIFE = 0.14;
const EVOLVED_KNOCKBACK_DISTANCE = 0.9; // evolved-only: instant push-back applied to every enemy struck
const HORIZONTAL_FACING_THRESHOLD = 0.6; // min |playerVX| (world units/s) before horizontalFacing updates

/**
 * Melee weapon: no projectile hit-testing - directly damages every enemy
 * inside a short rectangular band that is ALWAYS horizontal in world space
 * (extends along X, fixed thickness along Z) - it only ever mirrors
 * left/right, it never rotates to chase the player's full movement vector.
 * `horizontalFacing` (+1 right / -1 left) is the only directional state this
 * weapon reads, and it only updates from the player's horizontal (X) speed
 * component - moving purely up/down (Z-only) or diagonally never touches it,
 * so walking north with a prior rightward facing keeps striking right.
 * Progression is the whole point of this weapon's identity: Lv1 only ever
 * hits on the facing side; reaching Lv2 visibly unlocks the mirrored strike
 * on the other side too (mirrors real VS's whip, which swings through the
 * character once upgraded).
 */
export class WhipStrikeWeapon implements Weapon {
  readonly id = 'whip_strike';
  readonly name = 'Whip Strike';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  readonly handlesOwnHits = true; // damages directly; the slash visual is a life-limited decorative instance only
  /** Evolves into a longer, harder-hitting lash once the player also holds Vitality Ring (health passive). */
  readonly evolutionRequiresPassive = 'passive_health';

  private readonly visualId: number;
  private cooldown = 0;
  private horizontalFacing: 1 | -1 = 1;
  private readonly hitBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('whip_slash', 1.4, [1, 1, 1], false);
  }

  update(ctx: WeaponContext): void {
    // HORIZONTAL FACING ONLY: reads just the X component of movement, and
    // only past a deadzone threshold. Moving purely vertically (Z) or too
    // slowly along X leaves horizontalFacing exactly where it was.
    if (ctx.playerVX > HORIZONTAL_FACING_THRESHOLD) this.horizontalFacing = 1;
    else if (ctx.playerVX < -HORIZONTAL_FACING_THRESHOLD) this.horizontalFacing = -1;

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.35, BASE_COOLDOWN - 0.04 * (this.level - 1)) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const reach = (BASE_REACH + 0.12 * (this.level - 1)) * (this.evolved ? 1.35 : 1) * ctx.stats.areaMultiplier;
    const halfWidth = (BASE_HALF_WIDTH + 0.05 * (this.level - 1)) * ctx.stats.areaMultiplier;
    const damage = (BASE_DAMAGE + 1.9 * (this.level - 1)) * (this.evolved ? 1.4 : 1) * ctx.stats.damageMultiplier;

    // Lv1 only ever strikes on the facing side; the mirrored side is a Lv2+ unlock so the
    // upgrade reads as a visible new attack, not a hidden number change.
    const hitsBothSides = this.level >= 2;

    const queryRadius = Math.sqrt(reach * reach + halfWidth * halfWidth);
    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, queryRadius, this.hitBuffer);
    let hitAny = false;
    for (let i = 0; i < count; i++) {
      const enemyIndex = this.hitBuffer[i];
      const dx = ctx.enemies.posX[enemyIndex] - ctx.playerX;
      const dz = ctx.enemies.posZ[enemyIndex] - ctx.playerZ;
      // Pure horizontal band: `along` is the signed X distance relative to
      // facing (never mixes in dz), `across` is the raw Z offset (never
      // rotates with facing) - moving up/down/diagonally cannot tilt this.
      const along = dx * this.horizontalFacing;
      const across = dz;
      if (along < 0 && !hitsBothSides) continue; // Lv1: facing-side only
      if (Math.abs(along) > reach || Math.abs(across) > halfWidth) continue;
      const crit = ctx.rng() < ctx.stats.critChance;
      const dmg = damage * (crit ? ctx.stats.critMultiplier : 1);
      ctx.enemies.damage(enemyIndex, dmg, crit);
      hitAny = true;
      if (this.evolved) {
        // Evolved lash knocks struck enemies back along the hit vector instead of just damaging them in place.
        const pushDist = Math.sqrt(dx * dx + dz * dz) || 1;
        ctx.enemies.posX[enemyIndex] += (dx / pushDist) * EVOLVED_KNOCKBACK_DISTANCE;
        ctx.enemies.posZ[enemyIndex] += (dz / pushDist) * EVOLVED_KNOCKBACK_DISTANCE;
      }
    }

    // Decorative slash instance(s), both purely horizontal offsets from the
    // player (Z untouched): facing side always, mirrored side only once
    // Lv2+ unlocks it - so the visual swing matches exactly what can and
    // can't be hit, and explicitly represents the two distinct hit zones
    // instead of implying one continuous band.
    ctx.projectiles.spawn(this.visualId, ctx.playerX + this.horizontalFacing * reach * 0.5, ctx.playerZ, 0, 0, {
      damage: 0,
      radius: 0,
      pierce: 0,
      life: SLASH_VISUAL_LIFE,
      weaponId: this.weaponNumericId,
    });
    if (hitsBothSides) {
      ctx.projectiles.spawn(this.visualId, ctx.playerX - this.horizontalFacing * reach * 0.5, ctx.playerZ, 0, 0, {
        damage: 0,
        radius: 0,
        pierce: 0,
        life: SLASH_VISUAL_LIFE,
        weaponId: this.weaponNumericId,
      });
    }

    if (hitAny) gameEvents.emit('weaponFired', { weaponId: this.id, x: ctx.playerX, z: ctx.playerZ });
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
