import type { Weapon } from './WeaponBase';
import { VisualCache } from './WeaponBase';
import { MagicWandWeapon } from './MagicWand';
import { AxeWeapon } from './Axe';
import { KnifeWeapon } from './Knife';
import { FireballWeapon } from './Fireball';
import { GarlicWeapon } from './Garlic';
import { OrbiterWeapon } from './Orbiter';
import { WhipStrikeWeapon } from './WhipStrike';
import { ArcCrossWeapon } from './ArcCross';
import { EmberWandWeapon } from './EmberWand';
import { RuneShardWeapon } from './RuneShard';
import { HexFlaskWeapon } from './HexFlask';

export interface WeaponRosterEntry {
  id: string;
  name: string;
  maxLevel: number;
  create: (visuals: VisualCache, weaponNumericId: number) => Weapon;
}

/**
 * Fixed roster order - array index doubles as the numeric weaponId stamped
 * onto spawned projectiles (ProjectileManager.spawn opts.weaponId), so
 * WeaponSystem's generic hit-test pass can map a live projectile back to the
 * Weapon instance that owns it. Keep this order stable; do not reorder.
 */
export const WEAPON_ROSTER: WeaponRosterEntry[] = [
  { id: 'magic_wand', name: 'Magic Wand', maxLevel: 8, create: (v, n) => new MagicWandWeapon(v, n) },
  { id: 'axe_throw', name: 'Axe', maxLevel: 8, create: (v, n) => new AxeWeapon(v, n) },
  { id: 'knife_throw', name: 'Knife', maxLevel: 8, create: (v, n) => new KnifeWeapon(v, n) },
  { id: 'fireball', name: 'Fireball', maxLevel: 8, create: (v, n) => new FireballWeapon(v, n) },
  { id: 'garlic_aura', name: 'Garlic Aura', maxLevel: 8, create: (v, n) => new GarlicWeapon(v, n) },
  { id: 'orbiter_blades', name: 'Holy Blades', maxLevel: 8, create: (v, n) => new OrbiterWeapon(v, n) },
  { id: 'whip_strike', name: 'Whip Strike', maxLevel: 8, create: (v, n) => new WhipStrikeWeapon(v, n) },
  { id: 'arc_cross', name: 'Arc Cross', maxLevel: 8, create: (v, n) => new ArcCrossWeapon(v, n) },
  { id: 'ember_wand', name: 'Ember Wand', maxLevel: 8, create: (v, n) => new EmberWandWeapon(v, n) },
  { id: 'rune_shard', name: 'Rune Shard', maxLevel: 8, create: (v, n) => new RuneShardWeapon(v, n) },
  { id: 'hex_flask', name: 'Hex Flask', maxLevel: 8, create: (v, n) => new HexFlaskWeapon(v, n) },
];
