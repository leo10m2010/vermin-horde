import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { effectAt } from './WeaponProgression';

const RADIUS_COEFFICIENT = 2.2;
const ANGULAR_SPEED = 2.2; // rad/s
const HIT_RADIUS = 0.5;
const HIT_COOLDOWN = 0.35; // seconds a given blade must wait before re-damaging the same enemy
const PRUNE_INTERVAL = 5; // seconds between stale hit-cooldown cleanups
const EVOLVED_PULSE_INTERVAL = 3; // evolved-only: seconds between outward shockwave pulses
const EVOLVED_PULSE_RADIUS_BONUS = 1.6; // extra radius beyond the orbit ring for the pulse's reach
const EVOLVED_PULSE_DAMAGE_MULT = 1.5; // pulse damage relative to a single blade's per-tick damage

/** 2-5 (7 evolved) blades orbiting the player, continuously damaging any enemy they touch. */
export class OrbiterWeapon implements Weapon {
  readonly id = 'orbiter_blades';
  readonly name = 'Holy Blades';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  readonly handlesOwnHits = true;
  /** Evolves into a denser ring of blades once the player also holds Ammo Satchel (extra-projectile passive). */
  readonly evolutionRequiresPassive = 'passive_extra_projectile';

  private readonly visualId: number;
  /** Evolved Aureole Ring: gold blades. Swapped by rebuilding the ring on evolve. */
  private readonly evolvedVisualId: number;
  private readonly bladeIndices: number[] = [];
  private angle = 0;
  /** `${bladeSlot}:${enemyIndex}` -> elapsed time this blade may next damage that enemy. */
  private readonly hitCooldowns = new Map<string, number>();
  private lastPrune = 0;
  private readonly hitBuffer: number[] = [];
  private pulseCooldown = EVOLVED_PULSE_INTERVAL;
  /** Set by evolve(); the ring is rebuilt on the next update so the new blade sprite is used. */
  private pendingRebuild = false;

  constructor(private readonly visuals: VisualCache, private readonly weaponNumericId: number) {
    this.visualId = this.visuals.get('orbiter_blade', 0.62, [1, 1, 1], false);
    this.evolvedVisualId = this.visuals.get('orbiter_blade_evo', 0.75, [1, 1, 1], false);
  }

  /** Lv1:1, Lv2:2, Lv4:3, Lv6:4, Lv8:5 - read straight from the progression
   * table, so the level-up card's "+1 hoja" and the blades actually orbiting
   * are the same number by construction. Public for tests/showcase. */
  bladeCount(): number {
    return effectAt(this.id, this.level, this.evolved).blades ?? 1;
  }

  update(ctx: WeaponContext): void {
    if (this.pendingRebuild) {
      this.pendingRebuild = false;
      for (const index of this.bladeIndices) ctx.projectiles.despawn(index);
      this.bladeIndices.length = 0;
    }
    const target = this.bladeCount();
    while (this.bladeIndices.length < target) {
      const index = ctx.projectiles.spawn(this.evolved ? this.evolvedVisualId : this.visualId, ctx.playerX, ctx.playerZ, 0, 0, {
        damage: 0, // damage is applied directly by this weapon, not through the generic hit resolver
        radius: HIT_RADIUS,
        pierce: 0,
        life: Infinity,
        weaponId: this.weaponNumericId,
      });
      if (index === -1) break; // pool exhausted; try again next frame
      this.bladeIndices.push(index);
    }

    this.angle += ctx.dt * ANGULAR_SPEED;
    const e = effectAt(this.id, this.level, this.evolved);
    const orbitRadius = (e.radius ?? RADIUS_COEFFICIENT) * ctx.stats.areaMultiplier;
    const damagePerTick = e.damage * ctx.stats.damageMultiplier;

    for (let slot = 0; slot < this.bladeIndices.length; slot++) {
      const projIndex = this.bladeIndices[slot];
      if (!ctx.projectiles.alive[projIndex]) continue; // pool was cleared externally (e.g. run reset)
      const theta = this.angle + (slot * Math.PI * 2) / this.bladeIndices.length;
      const x = ctx.playerX + Math.cos(theta) * orbitRadius;
      const z = ctx.playerZ + Math.sin(theta) * orbitRadius;
      ctx.projectiles.setPosition(projIndex, x, z);
      ctx.projectiles.setVelocity(projIndex, -Math.sin(theta) * ANGULAR_SPEED * orbitRadius, Math.cos(theta) * ANGULAR_SPEED * orbitRadius);

      const count = ctx.enemies.queryRadius(x, z, HIT_RADIUS, this.hitBuffer);
      for (let i = 0; i < count; i++) {
        const enemyIndex = this.hitBuffer[i];
        const key = `${slot}:${enemyIndex}`;
        const readyAt = this.hitCooldowns.get(key) ?? 0;
        if (readyAt > ctx.elapsed) continue;
        const crit = ctx.rng() < ctx.stats.critChance;
        const dmg = damagePerTick * (crit ? ctx.stats.critMultiplier : 1);
        ctx.enemies.damage(enemyIndex, dmg, crit, this.id);
        this.hitCooldowns.set(key, ctx.elapsed + HIT_COOLDOWN);
      }
    }

    if (this.evolved) {
      // Evolved ring periodically releases an outward shockwave beyond the blades' own reach, on top of the extra blades themselves.
      this.pulseCooldown -= ctx.dt;
      if (this.pulseCooldown <= 0) {
        this.pulseCooldown = EVOLVED_PULSE_INTERVAL;
        const pulseRadius = orbitRadius + EVOLVED_PULSE_RADIUS_BONUS;
        const pulseCount = ctx.enemies.queryRadius(ctx.playerX, ctx.playerZ, pulseRadius, this.hitBuffer);
        const pulseDamage = damagePerTick * EVOLVED_PULSE_DAMAGE_MULT;
        for (let i = 0; i < pulseCount; i++) {
          const enemyIndex = this.hitBuffer[i];
          const crit = ctx.rng() < ctx.stats.critChance;
          const dmg = pulseDamage * (crit ? ctx.stats.critMultiplier : 1);
          ctx.enemies.damage(enemyIndex, dmg, crit, this.id);
        }
      }
    }

    if (ctx.elapsed - this.lastPrune > PRUNE_INTERVAL) {
      this.lastPrune = ctx.elapsed;
      for (const [key, readyAt] of this.hitCooldowns) {
        if (readyAt < ctx.elapsed - 1) this.hitCooldowns.delete(key);
      }
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
    // Blades are life:Infinity instances created once, so the sprite swap only
    // takes effect if the existing ring is torn down and rebuilt next frame.
    this.pendingRebuild = true;
  }
}
