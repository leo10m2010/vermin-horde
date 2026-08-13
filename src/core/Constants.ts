// Central tunables shared by every subsystem. Keep gameplay numbers here so
// balance passes touch one file instead of hunting through managers.

export const WORLD = {
  halfExtent: 140, // world is a square [-140, 140] on X and Z
  groundY: 0,
};

export const CAMERA = {
  // Elevation angle (degrees) of the orthographic camera above the ground
  // plane. ~58deg reads as "top-down" while leaving enough vertical face on
  // billboarded sprites to stay readable as pixel-art characters.
  elevationDeg: 58,
  distance: 46,
  viewHeight: 20, // world units visible vertically at zoom=1
  followLag: 0.12,
  near: 0.1,
  far: 220,
};

/**
 * WORLD Y positions for each visual layer - not abstract sort keys.
 *
 * Every sprite batch is a FEET-ANCHORED billboard (its quad spans y 0..1 from
 * this position upward, see InstancedBillboardBatch's geometry), so whatever
 * goes in here is literally how high off the floor that sprite's feet are.
 * The old values (enemy 0.6, player 0.62, boss 0.9) were chosen as draw-order
 * layers, but they had the side effect of lifting every character and monster
 * clean off the ground: with the camera at 58 degrees, world +Y projects onto
 * screen-up at 0.53, so 0.62 units became ~11px of visible gap between a
 * character's feet and its own ground shadow - about 22% of the character's
 * on-screen height. That gap is what made the whole game read as "floating",
 * the aura included.
 *
 * Ground-contact layers are therefore collapsed to a hair above the floor
 * (differences of ~0.002 are still plenty for the depth buffer to order them,
 * and project to well under a pixel). Draw order between batches is handled
 * explicitly via renderOrder instead - see InstancedBillboardBatch.
 *
 * Layers that SHOULD be off the ground keep real height: a bolt flies at
 * waist level, a damage number floats overhead.
 */
export const LAYER_Y = {
  ground: 0,
  decor: 0.004,
  // --- ground-contact layers: feet must touch the floor -------------------
  gem: 0.010,
  enemy: 0.016,
  elite: 0.018,
  boss: 0.020,
  player: 0.024,
  // --- deliberately airborne ----------------------------------------------
  projectile: 0.45,
  particle: 0.55,
  damageNumber: 1.6,
};

/**
 * Draw order between the sprite batches. Ground decals must paint UNDER the
 * things standing on them, which the depth buffer alone will not guarantee
 * now that everything shares nearly the same Y.
 */
export const RENDER_ORDER = {
  groundZone: 1, // weapon AoE decals (Garlic, Hex Flask)
  shadow: 2, // contact shadows
  gem: 3,
  enemy: 5,
  projectile: 6,
  particle: 7,
  player: 50, // always on top - never buried under a horde
};

export const PLAYER = {
  baseSpeed: 6.4,
  acceleration: 16,
  baseMaxHealth: 100,
  baseArmor: 0,
  baseMagnet: 2.4,
  invulnAfterHitSeconds: 0.5,
  radius: 0.42,
};

export const XP = {
  // level N requires curve(N) xp; tuned for a ~20-30 minute run.
  curve: (level: number) => Math.round(6 + level * level * 2.1 + level * 6),
  gemBaseValue: 1,
};

export const DIFFICULTY = {
  // Run length target ~20 minutes (1200s) for a full escalation arc.
  rampSeconds: 1200,
  eliteChanceStart: 0.02,
  eliteChanceEnd: 0.16,
  // Start gentle (a handful of enemies trickle in over the first ~10-15s)
  // and ramp hard toward the endgame horde. The original 6/s start dumped
  // ~90 enemies on the player within 15 real seconds during QA playtesting,
  // killing a stationary-ish player almost immediately - not a fair opener.
  spawnBudgetStart: 1.4, // enemies "worth" per second at t=0
  spawnBudgetEnd: 90,
  bossTimesSeconds: [180, 420, 720, 1020], // boss waves at 3/7/12/17 min
};

export const POOL_CAPACITY = {
  enemies: 1600,
  projectiles: 900,
  gems: 1200,
  particles: 2200,
  // Gilded Caches are a rare elite/boss drop - never more than a handful alive at once.
  treasures: 24,
  // Each damage number is its own THREE.Sprite + CanvasTexture (not part of
  // the shared InstancedBillboardBatch system), so this pool size directly
  // bounds worst-case draw calls/textures during heavy multi-weapon combat.
  // Kept modest on purpose - plenty for readable feedback, far cheaper than
  // the 160 default once every slot has cycled at least once in a long run.
  damageNumbers: 48,
};

export const SPATIAL_HASH_CELL = 4; // world units per cell

export const COLOR = {
  bg: '#0c0f0a',
  fog: '#0c0f0a',
};
