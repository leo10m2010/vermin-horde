import { gameEvents } from '../core/EventBus';
import type { Weapon, WeaponContext } from './WeaponBase';
import { VisualCache } from './WeaponBase';

const SEARCH_RANGE = 11; // radius to look for a target enemy to lob at
const FALLBACK_LOB_DISTANCE = 6; // used when no enemy is in range, so the flask still lands somewhere useful
const BASE_COOLDOWN = 3.0;
const TRAVEL_TIME = 0.55; // fixed flight duration before the flask lands, regardless of distance
const BASE_ZONE_DURATION = 3;
const ZONE_TICK_INTERVAL = 0.5;
const BASE_ZONE_RADIUS = 1.9;
const BASE_TICK_DAMAGE = 5;
const ZONE_COLOR = '#a6ff8c';
const ZONE_OPACITY = 0.5;
const EVOLVED_SATELLITE_OFFSET_FACTOR = 0.9; // evolved-only: distance (relative to zone radius) of the second zone from the primary landing point

interface FlightState {
  arriveAt: number;
  landX: number;
  landZ: number;
}

interface ZoneState {
  x: number;
  z: number;
  radius: number;
  tickDamage: number;
  nextTickAt: number;
  /** Ground-ring visual slot (GroundAreaRings), released when the zone expires. */
  ringIndex: number;
  expireAt: number;
}

/**
 * Ground zone generator: periodically lobs a flask on a short fixed-time
 * (not hit-triggered) arc toward a target; on arrival it despawns the flight
 * visual and leaves a stationary damaging zone that re-ticks damage on its
 * own cooldown for several seconds, mirroring Garlic's direct-damage tick
 * pattern rather than the generic single-hit projectile resolver.
 */
export class HexFlaskWeapon implements Weapon {
  readonly id = 'hex_flask';
  readonly name = 'Hex Flask';
  level = 1;
  readonly maxLevel = 8;
  evolved = false;
  readonly handlesOwnHits = true; // both the flight arc and the lingering zone are damage-free to the generic resolver; damage is applied directly
  /** Evolves into a shattering hex once the player also holds Timeless Hourglass (duration passive) - fitting, since this weapon's whole identity is its lingering zone's duration. */
  readonly evolutionRequiresPassive = 'passive_duration';

  private readonly flightVisualId: number;
  private cooldown = 0;
  private readonly flights = new Map<number, FlightState>();
  private readonly zones = new Map<number, ZoneState>();
  private readonly hitBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.flightVisualId = visuals.get('proj_hexflask', 0.5, [1, 1, 1], true);
  }

  update(ctx: WeaponContext): void {
    this.stepFlights(ctx);
    this.tickZones(ctx);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    // Balance: evolved no longer also gets a cooldown discount (was 0.7) -
    // the satellite zone below already doubles zone output per throw, so
    // stacking a recast-rate bonus on top of that plus the damage and
    // duration bumps pushed evolve to ~6x DPS vs. the ~1.7-2x other weapons
    // get from their evolutions.
    this.cooldown = Math.max(1.5, BASE_COOLDOWN - 0.09 * (this.level - 1)) * ctx.stats.cooldownMultiplier;

    const target = ctx.enemies.queryNearest(ctx.playerX, ctx.playerZ, SEARCH_RANGE);
    let landX: number;
    let landZ: number;
    if (target !== -1) {
      landX = ctx.enemies.posX[target];
      landZ = ctx.enemies.posZ[target];
    } else {
      const angle = ctx.rng() * Math.PI * 2;
      landX = ctx.playerX + Math.cos(angle) * FALLBACK_LOB_DISTANCE;
      landZ = ctx.playerZ + Math.sin(angle) * FALLBACK_LOB_DISTANCE;
    }

    const dx = landX - ctx.playerX;
    const dz = landZ - ctx.playerZ;
    const index = ctx.projectiles.spawn(this.flightVisualId, ctx.playerX, ctx.playerZ, dx / TRAVEL_TIME, dz / TRAVEL_TIME, {
      damage: 0,
      radius: 0.4,
      pierce: 0,
      life: Infinity, // self-managed: despawned explicitly in stepFlights() on arrival
      weaponId: this.weaponNumericId,
    });
    if (index === -1) return;
    this.flights.set(index, { arriveAt: ctx.elapsed + TRAVEL_TIME, landX, landZ });
  }

  private stepFlights(ctx: WeaponContext): void {
    for (const [index, state] of this.flights) {
      if (!ctx.projectiles.alive[index]) {
        this.flights.delete(index);
        continue;
      }
      if (ctx.elapsed < state.arriveAt) continue;

      ctx.projectiles.despawn(index);
      this.flights.delete(index);

      const radius = (BASE_ZONE_RADIUS + 0.06 * (this.level - 1)) * (this.evolved ? 1.4 : 1) * ctx.stats.areaMultiplier;
      // Balance: duration was 1.5 and damage was 1.4 - both trimmed since the
      // satellite zone spawned below already doubles total zone output.
      const duration = (BASE_ZONE_DURATION + 0.15 * (this.level - 1)) * (this.evolved ? 1.15 : 1) * ctx.stats.durationMultiplier;
      const tickDamage = (BASE_TICK_DAMAGE + 0.6 * (this.level - 1)) * (this.evolved ? 1.15 : 1) * ctx.stats.damageMultiplier;

      const zoneIndex = ctx.groundRings.acquire();
      if (zoneIndex === -1) continue;
      ctx.groundRings.set(zoneIndex, state.landX, state.landZ, radius, ZONE_COLOR, ZONE_OPACITY);
      this.zones.set(zoneIndex, {
        x: state.landX,
        z: state.landZ,
        radius,
        tickDamage,
        nextTickAt: ctx.elapsed,
        ringIndex: zoneIndex,
        expireAt: ctx.elapsed + duration,
      });
      gameEvents.emit('weaponFired', { weaponId: this.id, x: state.landX, z: state.landZ });

      if (this.evolved) {
        // Evolved flask shatters into a second satellite zone nearby on landing, doubling ground coverage per throw.
        const angle = ctx.rng() * Math.PI * 2;
        const offset = radius * EVOLVED_SATELLITE_OFFSET_FACTOR;
        const satX = state.landX + Math.cos(angle) * offset;
        const satZ = state.landZ + Math.sin(angle) * offset;
        const satelliteIndex = ctx.groundRings.acquire();
        if (satelliteIndex !== -1) {
          ctx.groundRings.set(satelliteIndex, satX, satZ, radius, ZONE_COLOR, ZONE_OPACITY);
          this.zones.set(satelliteIndex, {
            x: satX,
            z: satZ,
            radius,
            tickDamage,
            nextTickAt: ctx.elapsed,
            ringIndex: satelliteIndex,
            expireAt: ctx.elapsed + duration,
          });
        }
      }
    }
  }

  private tickZones(ctx: WeaponContext): void {
    for (const [index, zone] of this.zones) {
      if (ctx.elapsed >= zone.expireAt) {
        ctx.groundRings.release(zone.ringIndex);
        this.zones.delete(index);
        continue;
      }
      // Re-affirm the ring every frame - GroundAreaRings has no built-in
      // lifetime, unlike the old projectile-based zone visual.
      ctx.groundRings.set(zone.ringIndex, zone.x, zone.z, zone.radius, ZONE_COLOR, ZONE_OPACITY);
      if (ctx.elapsed < zone.nextTickAt) continue;
      zone.nextTickAt = ctx.elapsed + ZONE_TICK_INTERVAL;

      const count = ctx.enemies.queryRadius(zone.x, zone.z, zone.radius, this.hitBuffer);
      for (let i = 0; i < count; i++) {
        const enemyIndex = this.hitBuffer[i];
        const crit = ctx.rng() < ctx.stats.critChance;
        const dmg = zone.tickDamage * (crit ? ctx.stats.critMultiplier : 1);
        ctx.enemies.damage(enemyIndex, dmg, crit);
      }
    }
  }

  levelUp(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  evolve(): void {
    this.evolved = true;
  }
}
