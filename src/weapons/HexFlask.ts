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
const ZONE_VISUAL_SIZE = BASE_ZONE_RADIUS * 2.1;

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

  private readonly flightVisualId: number;
  private readonly zoneVisualId: number;
  private cooldown = 0;
  private readonly flights = new Map<number, FlightState>();
  private readonly zones = new Map<number, ZoneState>();
  private readonly hitBuffer: number[] = [];

  constructor(visuals: VisualCache, private readonly weaponNumericId: number) {
    this.flightVisualId = visuals.get('proj_hexflask', 0.5, [1, 1, 1], true);
    this.zoneVisualId = visuals.get('zone_hex', ZONE_VISUAL_SIZE, [0.65, 1, 0.55], false);
  }

  update(ctx: WeaponContext): void {
    this.stepFlights(ctx);
    this.tickZones(ctx);

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(1.5, BASE_COOLDOWN - 0.09 * (this.level - 1)) * (this.evolved ? 0.7 : 1) * ctx.stats.cooldownMultiplier;

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
      const duration = (BASE_ZONE_DURATION + 0.15 * (this.level - 1)) * (this.evolved ? 1.5 : 1) * ctx.stats.durationMultiplier;
      const tickDamage = (BASE_TICK_DAMAGE + 0.6 * (this.level - 1)) * (this.evolved ? 1.4 : 1) * ctx.stats.damageMultiplier;

      const zoneIndex = ctx.projectiles.spawn(this.zoneVisualId, state.landX, state.landZ, 0, 0, {
        damage: 0,
        radius: 0,
        pierce: 0,
        life: duration,
        weaponId: this.weaponNumericId,
      });
      if (zoneIndex === -1) continue;
      this.zones.set(zoneIndex, { x: state.landX, z: state.landZ, radius, tickDamage, nextTickAt: ctx.elapsed });
      gameEvents.emit('weaponFired', { weaponId: this.id, x: state.landX, z: state.landZ });
    }
  }

  private tickZones(ctx: WeaponContext): void {
    for (const [index, zone] of this.zones) {
      if (!ctx.projectiles.alive[index]) {
        this.zones.delete(index);
        continue;
      }
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
