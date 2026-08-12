import { WORLD } from '../core/Constants';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const RANGE = 12;
const BASE_COOLDOWN = 1.0;
const BASE_DAMAGE = 6;
const BASE_SPEED = 16;
const WANDER_DURATION = 4; // total lifetime once launched
const DIRECTION_CHANGE_INTERVAL = 0.6;
const ARENA_SOFT_BOUNDARY = WORLD.halfExtent * 0.8; // beyond this, bias new headings back toward center
const EVOLVED_SEEK_RANGE = 6; // evolved-only: shards hunt for the nearest enemy within this radius at each turn
const EXTRA_PROJECTILE_ANGLE = (16 * Math.PI) / 180; // Amount (Ammo Satchel): extra shards fan out from the primary launch heading

/**
 * Fast, tiny, infinite-pierce projectile that never really "aims" after
 * launch - every `DIRECTION_CHANGE_INTERVAL` seconds it picks a new random
 * heading (biased back toward the arena center once it strays too far) and
 * keeps wandering/piercing through enemies until its total wander duration
 * elapses, then despawns naturally via its finite life.
 */
export class RuneShardWeapon implements Weapon {
  readonly id = 'rune_shard';
  readonly name = 'Rune Shard';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  /** Evolves into a swarm of swifter shards once the player also holds Swift Boots (speed passive). */
  readonly evolutionRequiresPassive = 'passive_speed';

  private readonly visualId: number;
  private cooldown = 0;
  /** projectile index -> elapsed time at which it should next pick a new heading. */
  private readonly nextTurnAt = new Map<number, number>();

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = visuals.get('proj_rune', 0.35, [1, 1, 1], true);
  }

  private pierce(): number {
    const base = 6 + Math.floor((this.level - 1) / 2);
    return this.evolved ? base + 3 : base;
  }

  update(ctx: WeaponContext): void {
    this.steerWanderers(ctx);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.35, BASE_COOLDOWN - 0.04 * (this.level - 1)) * (this.evolved ? 0.75 : 1) * ctx.stats.cooldownMultiplier;

    const target = ctx.enemies.queryNearest(ctx.playerX, ctx.playerZ, RANGE);
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    let angle: number;
    if (target !== -1) {
      const dx = ctx.enemies.posX[target] - ctx.playerX;
      const dz = ctx.enemies.posZ[target] - ctx.playerZ;
      angle = Math.atan2(dz, dx);
    } else {
      angle = ctx.rng() * Math.PI * 2;
    }

    const damage = (BASE_DAMAGE + 0.8 * (this.level - 1)) * (this.evolved ? 1.3 : 1) * ctx.stats.damageMultiplier;
    const life = WANDER_DURATION * ctx.stats.durationMultiplier;

    this.launchShard(ctx, angle, speed, damage, life);
    // Amount (Ammo Satchel) is compatible: extra shards launch fanned around the same initial heading, each wandering independently.
    const extra = Math.max(0, Math.round(ctx.stats.extraProjectiles));
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.floor(i / 2) + 1;
      this.launchShard(ctx, angle + side * step * EXTRA_PROJECTILE_ANGLE, speed, damage, life);
    }
  }

  private launchShard(ctx: WeaponContext, angle: number, speed: number, damage: number, life: number): void {
    const index = ctx.projectiles.spawn(this.visualId, ctx.playerX, ctx.playerZ, Math.cos(angle) * speed, Math.sin(angle) * speed, {
      damage,
      radius: 0.28,
      pierce: this.pierce(),
      life,
      weaponId: this.weaponNumericId,
    });
    if (index !== -1) this.nextTurnAt.set(index, ctx.elapsed + DIRECTION_CHANGE_INTERVAL);
  }

  private steerWanderers(ctx: WeaponContext): void {
    const speed = BASE_SPEED * ctx.stats.projectileSpeedMultiplier;
    for (const [index, turnAt] of this.nextTurnAt) {
      if (!ctx.projectiles.alive[index]) {
        this.nextTurnAt.delete(index);
        continue;
      }
      if (ctx.elapsed < turnAt) continue;

      const px = ctx.projectiles.posX[index];
      const pz = ctx.projectiles.posZ[index];
      let angle: number;
      const seekTarget = this.evolved ? ctx.enemies.queryNearest(px, pz, EVOLVED_SEEK_RANGE) : -1;
      if (seekTarget !== -1) {
        // Evolved shards actively hunt the nearest enemy at each turn instead of picking a fully random heading.
        const dx = ctx.enemies.posX[seekTarget] - px;
        const dz = ctx.enemies.posZ[seekTarget] - pz;
        angle = Math.atan2(dz, dx);
      } else if (Math.abs(px) > ARENA_SOFT_BOUNDARY || Math.abs(pz) > ARENA_SOFT_BOUNDARY) {
        // bias heading back toward the arena center with some spread so it doesn't hug the wall
        const centerAngle = Math.atan2(-pz, -px);
        angle = centerAngle + (ctx.rng() - 0.5) * Math.PI * 0.6;
      } else {
        angle = ctx.rng() * Math.PI * 2;
      }
      ctx.projectiles.setVelocity(index, Math.cos(angle) * speed, Math.sin(angle) * speed);
      this.nextTurnAt.set(index, ctx.elapsed + DIRECTION_CHANGE_INTERVAL);
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
