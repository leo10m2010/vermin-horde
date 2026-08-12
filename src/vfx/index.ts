// Barrel export for the director - construct each class once, add its
// `object3D` to the scene, and call `update(dt)` every frame. ParticleSystem
// additionally needs `.batch.setTexture(spriteAtlas.texture)` called once
// after `spriteAtlas.build()` runs, same as Player/EnemyManager/etc. in
// Game.ts (its InstancedBillboardBatch is constructed before the atlas has
// real pixels).
export { ParticleSystem } from './ParticleSystem';
export type { ParticleBurstOptions } from './ParticleSystem';
export { DamageNumbers } from './DamageNumbers';
export type { DamageNumberOptions } from './DamageNumbers';
export { BossTelegraphRings } from './BossTelegraphRings';
// Complementary layer to ParticleSystem: projectile motion trails + a sharp
// impact flash. Construct once, add `object3D` to the scene, call
// `update(dt, projectiles)` every frame, and rebind
// `batch.setTexture(spriteAtlas.texture)` once spriteAtlas.build() has run -
// same wiring as ParticleSystem above.
export { ProjectileTrails } from './ProjectileTrails';
// Collection-burst ring for XP gems (complements GemManager's own spawn-pop
// and idle-sparkle tuning). Construct once, add object3D, call update(dt).
export { GemCollectEffect } from './GemCollectEffect';
// Radial light-burst + rotating ray flourish on level-up / weapon evolution.
// Construct once, add object3D, call update(dt), and setAnchor(playerX, playerZ)
// every frame so it knows where to trigger.
export { LevelUpEffects } from './LevelUpEffects';
// Pulsing violet ground ring under every alive elite enemy, so elites read as
// dangerous beyond just being bigger. Construct once, add object3D, call
// update(dt, enemies) every frame.
export { EliteAura } from './EliteAura';
// Generic pooled flat ground-ring renderer for weapon-owned AoE indicators
// (Garlic's aura, Hex Flask's zones). Construct with a capacity, add
// object3D, and let weapon `update()` methods drive acquire/set/release
// directly - no per-frame update(dt) call needed here.
export { GroundAreaRings } from './GroundAreaRings';
