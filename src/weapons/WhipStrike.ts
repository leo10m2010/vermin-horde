import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const BASE_COOLDOWN = 1.0;
const BASE_DAMAGE = 10;
const BASE_REACH = 3.2; // half-length of the band along the facing axis, both directions
const BASE_HALF_WIDTH = 1.15; // half-width of the band perpendicular to facing
const SLASH_VISUAL_LIFE = 0.14;
const EVOLVED_KNOCKBACK_DISTANCE = 0.9; // evolved-only: instant push-back applied to every enemy struck

/**
 * Melee weapon: no projectile hit-testing - directly damages every enemy
 * inside a short rectangular band that extends both in FRONT of and BEHIND
 * the player along their current facing axis (mirrors real VS's whip, which
 * swings through the character rather than only outward). Facing comes from
 * current velocity; while stationary the last non-zero facing is reused so
 * the band doesn't collapse to a fixed default.
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
  private facingX = 1;
  private facingZ = 0;
  private readonly hitBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('whip_slash', 1.4, [1, 1, 1], false);
  }

  update(ctx: WeaponContext): void {
    const moveSpeedSq = ctx.playerVX * ctx.playerVX + ctx.playerVZ * ctx.playerVZ;
    if (moveSpeedSq > 0.01) {
      const invLen = 1 / Math.sqrt(moveSpeedSq);
      this.facingX = ctx.playerVX * invLen;
      this.facingZ = ctx.playerVZ * invLen;
    }

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.35, BASE_COOLDOWN - 0.04 * (this.level - 1)) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const reach = (BASE_REACH + 0.12 * (this.level - 1)) * (this.evolved ? 1.35 : 1) * ctx.stats.areaMultiplier;
    const halfWidth = (BASE_HALF_WIDTH + 0.05 * (this.level - 1)) * ctx.stats.areaMultiplier;
    const damage = (BASE_DAMAGE + 1.9 * (this.level - 1)) * (this.evolved ? 1.4 : 1) * ctx.stats.damageMultiplier;

    // perpendicular axis to facing, for the band's lateral extent
    const perpX = -this.facingZ;
    const perpZ = this.facingX;

    const queryRadius = Math.sqrt(reach * reach + halfWidth * halfWidth);
    const count = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, queryRadius, this.hitBuffer);
    let hitAny = false;
    for (let i = 0; i < count; i++) {
      const enemyIndex = this.hitBuffer[i];
      const dx = ctx.enemies.posX[enemyIndex] - ctx.playerX;
      const dz = ctx.enemies.posZ[enemyIndex] - ctx.playerZ;
      const along = dx * this.facingX + dz * this.facingZ; // signed distance along facing (front positive, behind negative)
      const across = dx * perpX + dz * perpZ; // signed lateral offset
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

    // Decorative slash instances on both sides so the swing reads visually even with no kills.
    ctx.projectiles.spawn(this.visualId, ctx.playerX + this.facingX * reach * 0.5, ctx.playerZ + this.facingZ * reach * 0.5, 0, 0, {
      damage: 0,
      radius: 0,
      pierce: 0,
      life: SLASH_VISUAL_LIFE,
      weaponId: this.weaponNumericId,
    });
    ctx.projectiles.spawn(this.visualId, ctx.playerX - this.facingX * reach * 0.5, ctx.playerZ - this.facingZ * reach * 0.5, 0, 0, {
      damage: 0,
      radius: 0,
      pierce: 0,
      life: SLASH_VISUAL_LIFE,
      weaponId: this.weaponNumericId,
    });

    if (hitAny) gameEvents.emit('weaponFired', { weaponId: this.id, x: ctx.playerX, z: ctx.playerZ });
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
