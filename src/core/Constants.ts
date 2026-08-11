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

export const LAYER_Y = {
  ground: 0,
  decor: 0.01,
  gem: 0.5,
  projectile: 0.55,
  enemy: 0.6,
  elite: 0.65,
  boss: 0.9,
  player: 0.62,
  particle: 0.7,
  damageNumber: 1.6,
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
