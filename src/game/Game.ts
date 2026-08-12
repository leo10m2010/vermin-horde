import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createOrthoCamera, createRenderer, resizeRenderer } from '../core/Renderer';
import { CAMERA, DIFFICULTY, PLAYER } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { createSeededRandom } from '../utils/random';
import { spriteAtlas } from '../render/SpriteAtlas';
import { registerCoreSprites } from '../render/SpriteLibrary';
import { registerCharacterSprites } from '../render/SpriteLibraryCharacters';
import { registerWeapon2Sprites } from '../render/SpriteLibraryWeapons2';
import { createGroundMesh } from '../render/WorldGround';
import { StageDecor } from '../render/StageDecor';
import { Player } from '../entities/Player';
import { EnemyManager } from '../entities/EnemyManager';
import { ProjectileManager } from '../entities/ProjectileManager';
import { GemManager } from '../entities/GemManager';
import { CameraRig } from '../systems/CameraRig';
import { GameState } from './GameState';
import { CHARACTERS, type CharacterDef } from './Characters';
import { STAGES, type StageDef } from './Stages';
import { MetaProgression } from './MetaProgression';
import { registerEnemyTypes, WaveDirector, type EnemyTypeIds } from '../enemies';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { UpgradeSystem, type UpgradeOption } from '../systems/UpgradeSystem';
import { ArcanaSystem, type ArcanaDef } from '../systems/ArcanaSystem';
import { TreasureSystem } from '../systems/TreasureSystem';
import { ParticleSystem, DamageNumbers, BossTelegraphRings, ProjectileTrails, GemCollectEffect, LevelUpEffects, EliteAura, GroundAreaRings } from '../vfx';
import { UiRoot, type UpgradeOptionLike, type PauseBuildInfo } from '../ui/UiRoot';
import { getWeaponMetadata, WEAPON_EVOLUTION_PASSIVE_ID } from '../weapons/WeaponMetadata';
import { PASSIVE_DEFS } from '../systems/UpgradeSystem';
import { CharacterSelect } from '../ui/CharacterSelect';
import { StageSelect } from '../ui/StageSelect';
import { Shop } from '../ui/Shop';
import { ArcanaPicker } from '../ui/ArcanaPicker';
import { AudioManager } from '../audio/AudioManager';
import { t } from '../i18n';
import { drawCharacterPortrait } from '../render/SpriteLibraryCharacters';
import { getUpgradeIconDataUrl } from '../ui/Icons';
import { MenuScene } from '../render/MenuScene';

const VICTORY_SECONDS = DIFFICULTY.rampSeconds; // survive the full escalation arc to win
const PLAYER_START_INVULN = 0.8;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = createOrthoCamera(CAMERA.viewHeight, CAMERA.near, CAMERA.far);
  private readonly input: InputController;
  private readonly cameraRig: CameraRig;
  private readonly state = new GameState();

  private readonly player = new Player();
  private readonly enemies = new EnemyManager();
  private readonly projectiles = new ProjectileManager();
  private readonly gems = new GemManager();
  private readonly enemyTypes: EnemyTypeIds;
  private readonly waveDirector: WaveDirector;
  private readonly weaponSystem: WeaponSystem;
  private readonly upgradeSystem: UpgradeSystem;
  private readonly arcanaSystem: ArcanaSystem;
  private readonly treasures: TreasureSystem;
  private readonly stageDecor = new StageDecor();
  private readonly metaProgression = new MetaProgression();
  private readonly particles = new ParticleSystem();
  private readonly damageNumbers = new DamageNumbers();
  private readonly bossTelegraphs = new BossTelegraphRings();
  private readonly projectileTrails = new ProjectileTrails();
  private readonly gemCollectEffect = new GemCollectEffect();
  private readonly levelUpEffects = new LevelUpEffects();
  private readonly eliteAura = new EliteAura();
  /** Flat ground rings for weapon AoE indicators (Garlic's aura, Hex Flask's zones) - capacity covers Garlic's 1 permanent ring plus several concurrent Hex Flask zones with margin. */
  private readonly groundRings = new GroundAreaRings(20, 'vfx-weapon-ground-rings');
  private readonly audio = new AudioManager();
  /** Independent Three.js scene/camera for the main-menu backdrop - swapped into the shared renderer instead of the gameplay scene while phase === 'menu' (see render()).
   * Constructed in the constructor BODY (not as a field initializer) - it builds its own InstancedBillboardBatch sampling `spriteAtlas.texture`, and field initializers run before spriteAtlas.build() rasterizes real pixels into that texture, same trap the comment below already works around for every other batch. */
  private readonly menuScene: MenuScene;
  private readonly ui: UiRoot;
  private readonly characterSelect: CharacterSelect;
  private readonly stageSelect: StageSelect;
  private readonly shop: Shop;
  private readonly arcanaPicker: ArcanaPicker;

  private groundMesh: THREE.Mesh | null = null;
  private selectedCharacter: CharacterDef = CHARACTERS[0];
  private selectedStage: StageDef = STAGES[0];
  private goldAtRunStart = 0;
  private readonly powerSlotEls: Array<{ root: HTMLElement; icon: HTMLImageElement; level: HTMLElement }> = [];
  private lastHudHealth = -1;
  private lastPowerSlotSignature = '';

  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private frame = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsValue = 0;
  private rng = createSeededRandom(1);
  private pendingLevelUps = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private godMode = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);

    const stick = this.getElement('#touch-stick');
    const knob = this.getElement('#touch-knob');
    this.input = new InputController(stick, knob);
    this.cameraRig = new CameraRig(this.camera);

    registerCoreSprites();
    registerCharacterSprites();
    registerWeapon2Sprites();
    spriteAtlas.build();
    // Rebind every batch's shared texture reference now that the atlas canvas
    // has real pixels (batches are constructed before build() runs).
    this.player.batch.setTexture(spriteAtlas.texture);
    this.enemies.batch.setTexture(spriteAtlas.texture);
    this.projectiles.batch.setTexture(spriteAtlas.texture);
    this.gems.batch.setTexture(spriteAtlas.texture);
    this.particles.batch.setTexture(spriteAtlas.texture);
    this.projectileTrails.batch.setTexture(spriteAtlas.texture);
    this.stageDecor.batch.setTexture(spriteAtlas.texture);

    this.enemyTypes = registerEnemyTypes(this.enemies);
    this.waveDirector = new WaveDirector(this.enemies, this.enemyTypes, () => this.rng());
    this.weaponSystem = new WeaponSystem(this.enemies, this.projectiles, this.groundRings, () => this.rng());
    this.upgradeSystem = new UpgradeSystem(this.weaponSystem);
    this.arcanaSystem = new ArcanaSystem(() => this.rng());
    this.treasures = new TreasureSystem(this.upgradeSystem, () => this.rng());
    this.treasures.batch.setTexture(spriteAtlas.texture);
    // Built here (not as a field initializer, see the field's own comment) so its internal
    // character billboard batch samples the atlas texture only after build() has real pixels.
    this.menuScene = new MenuScene();

    const uiRootEl = this.getElement('#ui-root');
    this.ui = new UiRoot(uiRootEl, {
      onStartRun: () => this.openCharacterSelect(),
      onResumeRun: () => this.resumeRun(),
      onRestartRun: () => this.beginRun(),
      onUpgradeChosen: (option) => this.handleUpgradeChosen(option),
      onOpenShop: () => this.openShop(),
      onQuitToMenu: () => this.quitToMenu(),
    });
    this.characterSelect = new CharacterSelect(
      uiRootEl,
      (character) => this.onCharacterChosen(character),
      () => this.backToMainMenu(),
    );
    this.stageSelect = new StageSelect(
      uiRootEl,
      (stage) => this.onStageChosen(stage),
      () => this.backToCharacterSelect(),
    );
    this.shop = new Shop(uiRootEl, this.metaProgression, { onClose: () => this.closeShop() });
    this.arcanaPicker = new ArcanaPicker(uiRootEl, (arcana) => this.onArcanaChosen(arcana));

    this.buildScene();
    this.cameraRig.snapTo(this.player.position);
    resizeRenderer(this.renderer, this.camera, CAMERA.viewHeight);
    this.installTestHooks();
    this.bindEvents();
    this.applyStaticHudTranslations();
    this.buildPowerSlots();
    // Respect the OS-level setting for the WebGL side too - CSS already
    // covers the DOM/menu-backdrop animations on its own via @media queries.
    this.applyReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    this.menuScene.playIntro();
    this.ui.showMainMenu();
    this.publishDiagnostics();
  }

  private applyReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    this.menuScene.setReducedMotion(enabled);
  }

  /** Builds the 6 fixed power-slot DOM nodes once; updatePowerSlots() only ever mutates their icon/level/classes afterward. */
  private buildPowerSlots(): void {
    const container = this.getElement('#hud-power-slots');
    for (let i = 0; i < 6; i++) {
      const root = document.createElement('div');
      root.className = 'hud-power-slot';
      const icon = document.createElement('img');
      icon.className = 'hud-power-slot-icon';
      icon.alt = '';
      const level = document.createElement('div');
      level.className = 'hud-power-slot-level';
      root.append(icon, level);
      container.append(root);
      this.powerSlotEls.push({ root, icon, level });
    }
  }

  /** index.html's HUD labels ("Lv", "muertes") are static markup, not JS-rendered - translate them once at boot instead of on every updateHud() call. */
  private applyStaticHudTranslations(): void {
    const levelLabel = document.getElementById('hud-level-label');
    if (levelLabel) levelLabel.textContent = t('Lv');
    const killsLabel = document.getElementById('hud-kills-label');
    if (killsLabel) killsLabel.textContent = t('muertes');
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.menuScene.dispose();
    this.player.dispose();
    this.enemies.dispose();
    this.projectiles.dispose();
    this.gems.dispose();
    this.treasures.dispose();
    this.stageDecor.dispose();
    this.particles.dispose();
    this.damageNumbers.dispose();
    this.bossTelegraphs.dispose();
    this.projectileTrails.dispose();
    this.gemCollectEffect.dispose();
    this.levelUpEffects.dispose();
    this.eliteAura.dispose();
    this.groundRings.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    gameEvents.clear();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private buildScene(): void {
    this.scene.background = new THREE.Color('#0c0f0a');
    this.groundMesh = createGroundMesh();
    this.scene.add(this.groundMesh);
    this.scene.add(this.stageDecor.batch.mesh);
    // Flat ground shadows first, so every character/enemy billboard draws on top of its own blob.
    this.scene.add(this.player.shadowBatch.mesh);
    this.scene.add(this.enemies.shadowBatch.mesh);
    this.scene.add(this.player.batch.mesh);
    this.scene.add(this.enemies.batch.mesh);
    this.scene.add(this.projectiles.batch.mesh);
    this.scene.add(this.gems.batch.mesh);
    this.scene.add(this.treasures.batch.mesh);
    this.scene.add(this.particles.object3D);
    this.scene.add(this.damageNumbers.object3D);
    this.scene.add(this.bossTelegraphs.object3D);
    this.scene.add(this.projectileTrails.object3D);
    this.scene.add(this.gemCollectEffect.object3D);
    this.scene.add(this.levelUpEffects.object3D);
    this.scene.add(this.eliteAura.object3D);
    this.scene.add(this.groundRings.object3D);
  }

  private applyStage(stage: StageDef): void {
    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as THREE.Material).dispose();
    }
    this.groundMesh = createGroundMesh(stage);
    this.scene.add(this.groundMesh);
    this.scene.background = new THREE.Color(stage.fogTint ?? '#0c0f0a');
    this.stageDecor.populate(stage, () => this.rng());
  }

  // --- pre-run flow (menu -> character select -> stage select -> run) -----

  private openCharacterSelect(): void {
    this.ui.hideMainMenu();
    this.characterSelect.show(CHARACTERS);
  }

  private onCharacterChosen(character: CharacterDef): void {
    this.selectedCharacter = character;
    this.characterSelect.hide();
    this.stageSelect.show(STAGES);
  }

  private onStageChosen(stage: StageDef): void {
    this.selectedStage = stage;
    this.stageSelect.hide();
    this.beginRun();
  }

  private backToMainMenu(): void {
    this.characterSelect.hide();
    this.ui.showMainMenu();
  }

  private backToCharacterSelect(): void {
    this.stageSelect.hide();
    this.characterSelect.show(CHARACTERS);
  }

  private openShop(): void {
    this.ui.hideMainMenu();
    this.shop.show();
  }

  private closeShop(): void {
    this.shop.hide();
    this.ui.showMainMenu();
  }

  // --- run lifecycle -----------------------------------------------------

  private beginRun(seed = Date.now() & 0xffffffff): void {
    this.state.reset(seed);
    this.rng = createSeededRandom(seed);

    this.enemies.clear();
    this.projectiles.clear();
    this.gems.clear();
    this.treasures.clear();
    this.groundRings.clear();
    this.weaponSystem.reset(this.selectedCharacter.startWeaponId);
    this.waveDirector.reset();
    this.arcanaSystem.reset();
    this.pendingLevelUps = 0;

    // Permanent shop upgrades form the base; the character's trait then
    // scales/adjusts on top of that for the run.
    this.metaProgression.applyToStats(this.state.stats);
    this.selectedCharacter.applyTrait(this.state.stats);
    this.goldAtRunStart = this.metaProgression.gold;

    this.player.position.set(0, this.player.position.y, 0);
    this.player.velocity.set(0, 0, 0);
    this.player.invulnTimer = PLAYER_START_INVULN;
    this.player.revive();
    this.player.setSpriteKey(this.selectedCharacter.spriteKey);

    this.applyStage(this.selectedStage);
    this.activateRunHud();

    this.cameraRig.snapTo(this.player.position);
    this.ui.hideAll();
    this.characterSelect.hide();
    this.stageSelect.hide();
    this.shop.hide();
    this.arcanaPicker.hide();
    this.audio.init();
    gameEvents.emit('runStarted', {});
  }

  private pauseRun(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'paused';
    this.ui.showPause(this.buildPauseSummary());
    gameEvents.emit('runPaused', { paused: true });
  }

  /** Assembles the full current build (6 weapon slots + owned passives) for the pause overlay, so the player can see exactly what run they're playing. */
  private buildPauseSummary(): PauseBuildInfo {
    const weapons = this.weaponSystem.listOwned().map((w) => {
      const meta = getWeaponMetadata(w.id);
      const requirementId = WEAPON_EVOLUTION_PASSIVE_ID[w.id];
      const requirementOwned = !requirementId || (this.state.ownedPassives.get(requirementId) ?? 0) > 0;
      return {
        id: w.id,
        name: w.name,
        level: w.level,
        maxLevel: w.maxLevel,
        evolved: w.evolved,
        evolvedName: meta?.evolvedName,
        requirementName: meta?.evolutionRequirementName,
        requirementOwned,
      };
    });
    const passives = Array.from(this.state.ownedPassives.entries()).map(([id, count]) => {
      const def = PASSIVE_DEFS.find((p) => p.id === id);
      return { id, name: def?.name ?? id, count, maxStacks: def?.maxStacks ?? count };
    });
    return { characterName: this.selectedCharacter.name, level: this.state.run.level, weapons, passives };
  }

  private resumeRun(): void {
    if (this.state.phase !== 'paused') return;
    this.state.phase = 'playing';
    this.ui.hidePause();
    gameEvents.emit('runPaused', { paused: false });
  }

  /** Bail out of the current run (from pause, game-over, or victory) straight back to the main menu, discarding run progress. */
  private quitToMenu(): void {
    this.state.phase = 'menu';
    this.enemies.clear();
    this.projectiles.clear();
    this.gems.clear();
    this.treasures.clear();
    this.groundRings.clear();
    this.ui.hideAll();
    this.ui.showMainMenu();
    this.getElement('#hud').classList.remove('hud-active');
  }

  /** Draws the REAL selected character's portrait/name into the top-left HUD block and reveals it - called once per run start, never faked to a generic sprite. */
  private activateRunHud(): void {
    const canvas = this.getElement('#hud-portrait') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCharacterPortrait(ctx, canvas.width, this.selectedCharacter.spriteKey);
    }
    this.getElement('#hud-character-name').textContent = this.selectedCharacter.name;
    this.getElement('#hud').classList.add('hud-active');
    this.lastHudHealth = this.state.stats.health;
    this.lastPowerSlotSignature = '';
  }

  private triggerGameOver(): void {
    if (this.state.phase === 'gameover') return;
    this.state.phase = 'gameover';
    this.player.die();
    this.metaProgression.save();
    gameEvents.emit('playerDeath', { x: this.player.position.x, z: this.player.position.z });
    gameEvents.emit('runOver', {
      victory: false,
      survivedSeconds: this.state.run.elapsed,
      kills: this.state.run.kills,
      level: this.state.run.level,
    });
  }

  private triggerVictory(): void {
    if (this.state.phase === 'victory') return;
    this.state.phase = 'victory';
    this.metaProgression.save();
    gameEvents.emit('runOver', {
      victory: true,
      survivedSeconds: this.state.run.elapsed,
      kills: this.state.run.kills,
      level: this.state.run.level,
    });
  }

  private presentNextUpgrade(): void {
    if (this.pendingLevelUps <= 0) return;
    this.pendingLevelUps -= 1;
    this.state.phase = 'levelup';
    const options = this.upgradeSystem.rollChoices(() => this.rng(), this.state.ownedPassives, 3, this.state.stats.luck);
    this.ui.showUpgradePicker(options);
  }

  private handleUpgradeChosen(option: UpgradeOptionLike): void {
    this.upgradeSystem.apply(option as UpgradeOption, this.state.stats, this.state.ownedPassives);
    // Deferred: UiRoot's own click handler calls hideUpgradePicker() right
    // after this callback returns, which would immediately wipe a picker we
    // show synchronously here. Let that finish first.
    setTimeout(() => {
      if (this.pendingLevelUps > 0) this.presentNextUpgrade();
      else if (this.state.phase === 'levelup') this.state.phase = 'playing';
    }, 0);
  }

  private onArcanaChosen(arcana: ArcanaDef): void {
    this.arcanaSystem.apply(arcana, this.state.stats);
    gameEvents.emit('upgradeChosen', { id: arcana.id, name: arcana.name });
    this.particles.spawnBurst(this.player.position.x, this.player.position.z, { count: 70, colorHex: '#c9a227', speed: 8, life: 1.2 });
    this.cameraRig.shake(0.28, 0.35);
    this.state.phase = 'playing';
  }

  // --- main loop -----------------------------------------------------------

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    this.fpsAccum += delta;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.5) {
      this.fpsValue = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    resizeRenderer(this.renderer, this.camera, CAMERA.viewHeight);

    const playing = this.state.phase === 'playing';
    if (playing) this.state.run.elapsed += delta;

    const animDelta = this.reducedMotion ? 0 : delta;

    if (this.state.phase === 'menu') this.menuScene.update(animDelta, elapsed);

    this.player.update(playing ? animDelta : 0, this.input, this.state.stats, !playing);

    if (playing) {
      if (this.state.stats.regenPerSecond > 0) {
        this.state.stats.health = Math.min(this.state.stats.maxHealth, this.state.stats.health + this.state.stats.regenPerSecond * delta);
      }

      // Cache luck before any enemy can die this frame, so an elite/boss kill
      // (inside enemies.update() below) rolls its Gilded Cache chance against
      // the current build's luck rather than last frame's.
      this.treasures.setLuck(this.state.stats.luck);
      this.waveDirector.update(animDelta, this.state.run.elapsed, this.player.position.x, this.player.position.z, this.state.stats.luck);

      const { contactDamage } = this.enemies.update(animDelta, this.player.position.x, this.player.position.z);

      this.weaponSystem.trySetInventory(this.state.ownedPassives);
      this.weaponSystem.update(
        animDelta,
        this.state.run.elapsed,
        this.player.position.x,
        this.player.position.z,
        this.player.velocity.x,
        this.player.velocity.z,
        this.state.stats,
      );
      this.projectiles.update(animDelta);

      const collectRadius = 0.7;
      this.treasures.update(
        animDelta,
        this.player.position.x,
        this.player.position.z,
        this.state.stats.magnetRadius,
        collectRadius,
        this.state.ownedPassives,
        this.state.stats,
      );
      const xpGained = this.gems.update(animDelta, elapsed, this.player.position.x, this.player.position.z, this.state.stats.magnetRadius, collectRadius);
      if (xpGained > 0) {
        const levels = this.state.gainXp(xpGained);
        if (levels > 0) {
          this.pendingLevelUps += levels;
          gameEvents.emit('levelUp', { level: this.state.run.level });
          if (this.state.phase === 'playing') this.presentNextUpgrade();
        }
      }

      if (contactDamage > 0) this.applyPlayerDamage(contactDamage);

      this.arcanaSystem.tickActive(this.state.stats, this.state.run.elapsed);

      if (this.state.phase === 'playing') {
        const arcanaOffer = this.arcanaSystem.checkMilestone(this.state.run.elapsed);
        if (arcanaOffer) {
          this.state.phase = 'levelup';
          this.arcanaPicker.show(arcanaOffer);
        }
      }

      if (this.state.run.elapsed >= VICTORY_SECONDS) this.triggerVictory();

      if (this.input.consumePausePressed()) this.pauseRun();
    } else if (this.state.phase === 'paused') {
      if (this.input.consumePausePressed()) this.resumeRun();
    }

    this.particles.update(animDelta);
    this.damageNumbers.update(animDelta);
    this.bossTelegraphs.update(animDelta);
    this.projectileTrails.update(animDelta, this.projectiles);
    this.gemCollectEffect.update(animDelta);
    this.levelUpEffects.setAnchor(this.player.position.x, this.player.position.z);
    this.levelUpEffects.update(animDelta);
    this.eliteAura.update(animDelta, this.enemies);
    this.audio.update(delta, {
      elapsed: this.state.run.elapsed,
      enemyCount: this.enemies.activeCount,
      playerHealthFrac: this.state.stats.maxHealth > 0 ? this.state.stats.health / this.state.stats.maxHealth : 0,
      phase: this.state.phase,
    });

    this.cameraRig.update(delta, this.player.position);
    this.updateHud();
    this.publishDiagnostics();
  }

  private applyPlayerDamage(rawDamage: number): void {
    if (this.state.phase !== 'playing' || this.player.invulnTimer > 0 || this.godMode) return;
    const damage = Math.max(1, rawDamage - this.state.stats.armor);
    this.state.stats.health -= damage;
    this.state.run.damageTaken += damage;
    this.player.invulnTimer = PLAYER.invulnAfterHitSeconds;
    this.player.hitFlash();
    gameEvents.emit('playerHit', { damage, x: this.player.position.x, z: this.player.position.z });
    gameEvents.emit('screenShake', { intensity: 0.18, duration: 0.22 });
    if (this.state.stats.health <= 0) {
      this.state.stats.health = 0;
      this.triggerGameOver();
    }
  }

  private updateHud(): void {
    const level = this.getElement('#hud-level');
    level.textContent = String(this.state.run.level);
    const xpFill = this.getElement('#xp-bar-fill');
    xpFill.style.width = `${Math.min(100, (this.state.run.xp / this.state.run.xpToNext) * 100)}%`;
    const timer = this.getElement('#hud-timer');
    const m = Math.floor(this.state.run.elapsed / 60).toString().padStart(2, '0');
    const s = Math.floor(this.state.run.elapsed % 60).toString().padStart(2, '0');
    timer.textContent = `${m}:${s}`;
    const kills = this.getElement('#hud-kill-count');
    kills.textContent = String(this.state.run.kills);

    const healthFrac = this.state.stats.maxHealth > 0 ? Math.max(0, this.state.stats.health / this.state.stats.maxHealth) : 0;
    const healthPct = `${healthFrac * 100}%`;
    this.getElement('#health-bar-fill').style.width = healthPct;
    // Same target width, slower CSS transition (styles.css) - creates the trailing-damage ribbon effect for free.
    this.getElement('#health-bar-trail').style.width = healthPct;
    const healthText = this.getElement('#health-text');
    healthText.textContent = `${Math.ceil(Math.max(0, this.state.stats.health))}/${Math.ceil(this.state.stats.maxHealth)}`;

    if (this.lastHudHealth >= 0 && this.state.stats.health > this.lastHudHealth + 0.01) this.retriggerAnimClass('hud-flash-heal', '#health-bar');
    this.lastHudHealth = this.state.stats.health;

    this.updatePowerSlots();
  }

  /** Retriggers a CSS entrance animation class (remove -> reflow -> re-add) so repeated triggers restart cleanly instead of being no-ops. */
  private retriggerAnimClass(className: string, selector: string): void {
    const el = this.getElement(selector);
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  /** Cheap DOM diffing: only touches icon/level/class when the owned-weapon signature actually changed, since this runs every frame. */
  private updatePowerSlots(): void {
    const owned = this.weaponSystem.listOwned();
    const signature = owned.map((w) => `${w.id}:${w.level}:${w.evolved ? 1 : 0}`).join('|');
    if (signature === this.lastPowerSlotSignature) return;
    this.lastPowerSlotSignature = signature;

    for (let i = 0; i < this.powerSlotEls.length; i++) {
      const slot = this.powerSlotEls[i];
      const weapon = owned[i];
      if (!weapon) {
        slot.root.className = 'hud-power-slot';
        slot.icon.src = '';
        slot.icon.style.visibility = 'hidden';
        slot.level.textContent = '';
        continue;
      }
      slot.icon.style.visibility = 'visible';
      slot.icon.src = getUpgradeIconDataUrl(weapon.id);
      slot.level.textContent = weapon.evolved ? '★' : String(weapon.level);
      slot.root.className = `hud-power-slot hud-power-slot--filled${weapon.evolved ? ' hud-power-slot--evolved' : ''}`;
    }
  }

  private render(): void {
    if (this.state.phase === 'menu') {
      this.renderer.render(this.menuScene.scene, this.menuScene.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private minuteToastEl: HTMLElement | null = null;
  private minuteToastTimer: number | undefined;

  /** Quiet top-center toast announcing each survived minute (difficulty ramp feedback). Self-contained: no styles.css/UiRoot.ts changes needed. */
  private showMinuteToast(minute: number): void {
    this.showToast(`${t('MINUTO')} ${minute} — ${t('la horda crece')}`);
  }

  /** Generic reusable version of the toast above - same box, any message. */
  private showToast(text: string): void {
    if (!this.minuteToastEl) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;top:64px;left:50%;transform:translateX(-50%);' +
        'padding:6px 18px;border:1px solid rgba(201,162,39,0.5);border-radius:3px;' +
        'background:linear-gradient(180deg, rgba(28,16,13,0.92), rgba(6,4,3,0.92));' +
        'color:#e8c468;font-family:Georgia,"Times New Roman",serif;font-size:0.85rem;' +
        'letter-spacing:0.08em;text-shadow:1px 1px 0 rgba(0,0,0,0.9);' +
        'pointer-events:none;opacity:0;transition:opacity 0.4s ease;z-index:5;';
      this.getElement('#hud').appendChild(el);
      this.minuteToastEl = el;
    }
    const el = this.minuteToastEl;
    el.textContent = text;
    el.style.opacity = '1';
    if (this.minuteToastTimer !== undefined) window.clearTimeout(this.minuteToastTimer);
    this.minuteToastTimer = window.setTimeout(() => {
      el.style.opacity = '0';
    }, 2600);
  }

  private bindEvents(): void {
    gameEvents.on('enemyKilled', (e) => {
      this.state.run.kills += 1;
      if (e.isElite) this.state.run.eliteKills += 1;
      if (e.isBoss) this.state.run.bossKills += 1;
    });
    gameEvents.on('enemyHit', (e) => {
      this.state.run.damageDealt += e.damage;
    });
    gameEvents.on('gemCollected', (e) => {
      this.state.run.gemsCollected += 1;
      void e;
    });
    gameEvents.on('screenShake', (e) => this.cameraRig.shake(e.intensity, e.duration));
    gameEvents.on('enemyAttackRequest', (e) => this.applyPlayerDamage(e.damage));
    gameEvents.on('playerHit', () => this.retriggerAnimClass('hud-flash-damage', '#hud-portrait-frame'));
    gameEvents.on('bossSpawned', (e) => {
      this.ui.showBossBanner(e.name);
      this.particles.spawnBurst(e.x, e.z, { count: 60, colorHex: '#ff8a3d', speed: 9, life: 1.1 });
      this.cameraRig.shake(0.3, 0.4);
    });
    // Per-level character scaling (see CharacterDef.onLevelUp) - a no-op for
    // characters that only use the one-time applyTrait() bonus.
    gameEvents.on('levelUp', (e) => {
      this.selectedCharacter.onLevelUp?.(this.state.stats, e.level);
    });
    gameEvents.on('treasureSpawned', (e) => {
      this.particles.spawnBurst(e.x, e.z, { count: 18, colorHex: '#e8c468', speed: 3, life: 0.6 });
    });
    gameEvents.on('treasureOpened', (e) => {
      const pickList = e.rewardNames.length > 0 ? e.rewardNames.join(', ') : t('oro');
      this.showToast(`${t('COFRE DORADO')} — ${pickList} (+${e.bonusGold} ${t('oro')})`);
      this.particles.spawnBurst(e.x, e.z, { count: 80, colorHex: '#ffe066', speed: 8.5, life: 1.1 });
      this.cameraRig.shake(0.22, 0.3);
    });
    // Legible difficulty ramp: a quiet corner toast each survived minute so
    // the escalating horde reads as deliberate pacing, not silent RNG.
    gameEvents.on('waveEscalated', (e) => this.showMinuteToast(e.minute));
    // Weapon evolution is a headline "special power" moment - give it a
    // distinct, unmissable flourish instead of the quiet stat-only change it
    // had before.
    gameEvents.on('weaponEvolved', (e) => {
      this.particles.spawnBurst(this.player.position.x, this.player.position.z, { count: 46, colorHex: '#ffe066', speed: 7, life: 0.9 });
      this.cameraRig.shake(0.22, 0.3);
      const evolvedName = getWeaponMetadata(e.weaponId)?.evolvedName;
      this.showToast(`${t('EVOLUCIÓN')} — ${evolvedName ? t(evolvedName) : e.name}`);
    });
    gameEvents.on('runOver', (e) => {
      const stats = {
        survivedSeconds: e.survivedSeconds,
        kills: e.kills,
        level: e.level,
        goldEarned: Math.max(0, this.metaProgression.gold - this.goldAtRunStart),
      };
      if (e.victory) this.ui.showVictory(stats);
      else this.ui.showGameOver(stats);
    });
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
        this.state.seed = value;
      },
      setState: (name: string) => {
        if (name === 'active-play') this.beginRun();
        else if (name === 'paused') this.pauseRun();
        else if (name === 'levelup') {
          this.pendingLevelUps += 1;
          this.presentNextUpgrade();
        } else if (name === 'gameover') this.triggerGameOver();
        else if (name === 'victory') this.triggerVictory();
        else console.warn(`Unknown test state: ${name}`);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => this.applyReducedMotion(enabled),
      hideDebugUi: () => {
        /* no debug GUI yet */
      },
      spawnEnemies: (count: number, typeName?: keyof EnemyTypeIds) => {
        const typeId = typeName && typeName in this.enemyTypes ? this.enemyTypes[typeName] : this.enemyTypes.grunt;
        for (let i = 0; i < count; i++) {
          const angle = this.rng() * Math.PI * 2;
          const dist = 5 + this.rng() * 20;
          this.enemies.spawn(typeId, this.player.position.x + Math.cos(angle) * dist, this.player.position.z + Math.sin(angle) * dist);
        }
      },
      clearEnemies: () => this.enemies.clear(),
      grantLevels: (count: number) => {
        for (let i = 0; i < count; i++) {
          const levels = this.state.gainXp(this.state.run.xpToNext);
          if (levels > 0) {
            this.pendingLevelUps += levels;
            gameEvents.emit('levelUp', { level: this.state.run.level });
          }
        }
        if (this.state.phase === 'playing') this.presentNextUpgrade();
      },
      setGodMode: (enabled: boolean) => {
        this.godMode = enabled;
      },
      forceBoss: () => this.waveDirector.forceBoss(),
      // QA helper: skip straight to the next arcana milestone offer instead
      // of waiting out the real 5-minute-survived gate.
      forceArcana: () => {
        const offer = this.arcanaSystem.checkMilestone(999_999);
        if (offer) this.arcanaPicker.show(offer);
      },
      // QA helper: directly add/level/evolve a specific weapon by id, bypassing
      // the random upgrade-card roll - lets automated tests exercise every
      // weapon deterministically instead of hoping it comes up in a shuffle.
      addWeapon: (id: string) => this.weaponSystem.addWeapon(id),
      levelUpWeapon: (id: string) => this.weaponSystem.levelUp(id),
      grantPassive: (id: string) => {
        this.state.ownedPassives.set(id, (this.state.ownedPassives.get(id) ?? 0) + 1);
        this.weaponSystem.checkPendingEvolutions();
      },
      // QA helper: pick a roster character by id (see Characters.ts) without
      // driving the CharacterSelect UI - the next beginRun()/'active-play'
      // uses it. Silently no-ops on an unknown id so a typo in a test script
      // fails loud via the console.warn instead of a confusing wrong sprite.
      selectCharacter: (id: string) => {
        const character = CHARACTERS.find((c) => c.id === id);
        if (!character) {
          console.warn(`Unknown character id: ${id}`);
          return;
        }
        this.selectedCharacter = character;
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      fps: Math.round(this.fpsValue),
      elapsed: this.state.run.elapsed,
      phase: this.state.phase,
      level: this.state.run.level,
      kills: this.state.run.kills,
      eliteKills: this.state.run.eliteKills,
      bossKills: this.state.run.bossKills,
      health: this.state.stats.health,
      maxHealth: this.state.stats.maxHealth,
      gold: this.metaProgression.gold,
      player: {
        position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
        speed: this.player.velocity.length(),
      },
      enemyCount: this.enemies.activeCount,
      projectileCount: this.projectiles.activeCount,
      gemCount: this.gems.pool.activeCount,
      particleCount: 0,
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      },
    };
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
