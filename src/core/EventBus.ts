type Handler<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub so systems (audio, vfx, ui) can react to gameplay
 * events without importing each other directly. Keep event payloads plain
 * data so listeners never need to reach back into emitter internals.
 */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) (handler as Handler<Events[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Every gameplay event flowing between systems. Add new events here so all
// producers/consumers share one contract.
export type GameEvents = {
  playerHit: { damage: number; x: number; z: number };
  playerDeath: { x: number; z: number };
  /** A weapon's projectile resolved against the world (e.g. a thrown axe landing), for impact VFX. */
  weaponImpact: { x: number; z: number; weaponId: string };
  enemyHit: { x: number; z: number; damage: number; crit: boolean; enemyIndex: number; weaponId?: string };
  enemyKilled: { x: number; z: number; typeId: number; isElite: boolean; isBoss: boolean; xpValue: number };
  gemCollected: { x: number; z: number; value: number };
  levelUp: { level: number };
  upgradeChosen: { id: string; name: string };
  weaponFired: { weaponId: string; x: number; z: number };
  weaponEvolved: { weaponId: string; name: string };
  bossSpawned: { name: string; x: number; z: number };
  bossKilled: { name: string; x: number; z: number };
  waveEscalated: { minute: number };
  screenShake: { intensity: number; duration: number };
  runStarted: Record<string, never>;
  runPaused: { paused: boolean };
  runOver: { victory: boolean; survivedSeconds: number; kills: number; level: number };
  /** Enemies/bosses request player damage through here instead of touching Game/GameState directly. */
  enemyAttackRequest: { damage: number; x: number; z: number };
  /** A ground-telegraphed attack about to land; VFX draws the warning, enemies module deals the damage on expiry. */
  bossTelegraph: { x: number; z: number; radius: number; delaySeconds: number; color?: string };
  /** Passive/weapon evolution unlocked a new visual - lets VFX/audio react without polling. */
  passiveGained: { id: string; name: string };
  /** A Gilded Cache appeared in the world (elite/boss kill drop) - lets VFX mark the spot. */
  treasureSpawned: { x: number; z: number };
  /** Player collected a Gilded Cache; luck rolled `tier` bonus picks (1/3/5), already applied. */
  treasureOpened: { x: number; z: number; tier: number; rewardNames: string[]; bonusGold: number };
};

export const gameEvents = new EventBus<GameEvents>();
