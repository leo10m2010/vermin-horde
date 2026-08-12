/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  fps: number;
  elapsed: number;
  phase: string;
  level: number;
  kills: number;
  eliteKills: number;
  bossKills: number;
  health: number;
  maxHealth: number;
  gold: number;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
  };
  enemyCount: number;
  projectileCount: number;
  gemCount: number;
  particleCount: number;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  /** Distinct cells packed into the shared sprite atlas (drives its texture size). */
  atlasCells: number;
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void;
  /** Jump to a named state: 'active-play' | 'paused' | 'levelup' | 'gameover' | 'victory'. */
  setState(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide debug UI before capturing. */
  hideDebugUi(hidden: boolean): void;
  /** QA/perf helper: force-spawn N enemies around the player (stress testing). Defaults to grunt if typeName is omitted/unknown. */
  spawnEnemies(count: number, typeName?: string): void;
  /** QA helper: remove every active enemy. */
  clearEnemies(): void;
  /** QA helper: spawn one enemy at an exact (playerX+dx, playerZ+dz) offset; returns its pool index (-1 if the pool is full). */
  spawnEnemyAt(dx: number, dz: number, typeName?: string): number;
  /** QA helper: read back an enemy's current state by pool index (as returned by spawnEnemyAt). */
  getEnemyHp(index: number): { hp: number; maxHp: number; alive: boolean };
  /** QA helper: velocity vectors of every live projectile currently belonging to the given weapon id - lets a test assert a launch angle directly. */
  getProjectileVelocities(weaponId: string): Array<{ vx: number; vz: number }>;
  /** QA helper: grant enough XP to trigger N level-ups immediately. */
  grantLevels(count: number): void;
  /** QA helper: toggle invulnerability so bot playtests can survive long stress runs. */
  setGodMode(enabled: boolean): void;
  /** QA helper: force-spawn the next scheduled boss immediately. */
  forceBoss(): void;
  /** QA helper: directly add a specific weapon by id, bypassing the random upgrade roll. Returns false if already owned/slots full/unknown id. */
  addWeapon(id: string): boolean;
  /** QA helper: directly level up (and auto-evolve if maxed + passive satisfied) a specific owned weapon by id. */
  levelUpWeapon(id: string): boolean;
  /** QA helper: directly grant a stack of a specific passive by id (for testing evolutionRequiresPassive gates). */
  grantPassive(id: string): void;
  /** QA helper: skip straight to the next arcana milestone offer instead of waiting out the real 5-minute-survived gate. */
  forceArcana(): void;
  /** QA helper: pick a roster character by id (see Characters.ts) ahead of the next beginRun()/'active-play', without driving the CharacterSelect UI. */
  selectCharacter(id: string): void;
  /**
   * Art-inspection scene: parks one frozen instance of every enemy AND boss
   * type in a grid with the player among them, suspends wave spawning and
   * weapon fire, and zooms the camera out to fit the lineup. Returns the
   * layout (name + world x/z per slot) so a capture script can label it.
   */
  enemyShowcase(opts?: { pose?: string; columns?: number; spacing?: number; viewHeight?: number; only?: string[] }): Array<{ name: string; x: number; z: number }>;
  /** Art-inspection: force every live enemy into one pose ('idle'|'walk'|'attack'|'hit'|'special'|'death'), or null to release. */
  setEnemyPose(pose: string | null): void;
  /** QA helper: the pose every live enemy is currently playing, for asserting telegraphs actually fire in real gameplay. */
  getEnemyAnimStates(): Array<{ name: string; pose: string; isBoss: boolean }>;
  /** Art-inspection: leave showcase mode and clear the lineup. */
  exitEnemyShowcase(): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
