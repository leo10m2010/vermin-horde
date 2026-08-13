import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createOrthoCamera, createRenderer, resizeRenderer } from '../core/Renderer';
import { CAMERA, DIFFICULTY, LAYER_Y, PLAYER } from '../core/Constants';
import { gameEvents } from '../core/EventBus';
import { SecretCodeManager } from '../core/SecretCodeManager';
import { createSeededRandom } from '../utils/random';
import { spriteAtlas } from '../render/SpriteAtlas';
import { registerCoreSprites } from '../render/SpriteLibrary';
import { registerCharacterSprites } from '../render/SpriteLibraryCharacters';
import { registerWeapon2Sprites } from '../render/SpriteLibraryWeapons2';
import { createGroundMesh } from '../render/WorldGround';
import { StageDecor } from '../render/StageDecor';
import { WorldProps } from '../world/WorldProps';
import { PickupManager } from '../world/PickupManager';
import {
  rollDrop,
  findDrop,
  GOLD_PICKUP_VALUE,
  RATION_HEAL,
  FREEZE_SECONDS,
  PURGE_DAMAGE,
  FORTUNE_LUCK,
  type PickupKind,
} from '../world/DropTable';
import { Player } from '../entities/Player';
import { EnemyManager, ENEMY_POSES, type EnemyPose } from '../entities/EnemyManager';
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
import { UiRoot, type UpgradeOptionLike, type PauseBuildInfo, type PauseStatEntry } from '../ui/UiRoot';
import { getWeaponMetadata, WEAPON_EVOLUTION_PASSIVE_ID } from '../weapons/WeaponMetadata';
import { describeLevelUp, effectAt } from '../weapons/WeaponProgression';
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
/** Fixed camera target for the art-inspection showcase - the lineup is built centred on the world origin. */
const SHOWCASE_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
/** Scratch vector reused by the screen-projection QA hook - never allocate per sample. */
const SCREEN_PROBE = new THREE.Vector3();

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
  /** Gameplay prop layer: solid blockers + breakables. Separate from StageDecor's cheap scatter. */
  private readonly worldProps = new WorldProps();
  private readonly pickups = new PickupManager();
  /** Scratch for collision resolution, reused so the hot path never allocates. */
  private readonly collideScratch = { x: 0, z: 0 };
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
  private secretCode!: SecretCodeManager;
  private veilToastEl: HTMLElement | null = null;
  private veilToastTimer: number | undefined;
  /** Art-inspection mode: wave spawning and weapon fire suspended (see the `enemyShowcase` test hook). */
  private showcaseMode = false;
  /** Camera framing override while showcasing, so a whole lineup fits on screen. */
  private showcaseViewHeight = 0;
  /** Power-showcase only: suspends wave spawning while leaving weapons running (they are the subject). */
  private waveSpawningEnabled = true;
  /** weapon id -> total damage dealt this run, for the results-screen breakdown. Cleared on beginRun(). */
  private readonly damageByWeapon = new Map<string, number>();

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
    this.worldProps.batch.setTexture(spriteAtlas.texture);
    this.pickups.batch.setTexture(spriteAtlas.texture);

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
    // covers the remaining DOM/menu animations on its own via @media queries.
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
    this.secretCode.dispose();
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
    this.worldProps.dispose();
    this.pickups.dispose();
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
    this.scene.add(this.worldProps.batch.mesh);
    this.scene.add(this.worldProps.shadowBatch.mesh);
    this.scene.add(this.pickups.batch.mesh);
    this.scene.add(this.pickups.shadowBatch.mesh);
    // Enemies push out of solid props through the props' own static broad
    // phase, so the horde never costs N enemies x M props.
    this.enemies.setWorldCollider((x, z, r, out) => this.worldProps.resolve(x, z, r, out));

    // Undocumented. Not in settings, controls, tooltips or help - by design.
    this.secretCode = new SecretCodeManager({
      sequence: [
        'ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
        'KeyH', 'KeyV',
      ],
      // Only listens during a run, so it can never fire from a menu.
      isActive: () => this.state.phase === 'playing' || this.state.phase === 'paused',
      onMatch: () => this.toggleVeil(),
    });
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
    // Gameplay layer on top of the decorative scatter: a small number of solid
    // blockers to shape routes, plus a handful of breakables worth destroying.
    this.worldProps.populate(stage.propSet, () => this.rng());
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
    this.damageByWeapon.clear();

    this.enemies.clear();
    this.projectiles.clear();
    this.gems.clear();
    this.pickups.clear();
    this.treasures.clear();
    this.groundRings.clear();
    this.weaponSystem.reset(this.selectedCharacter.startWeaponId);
    // Never carried between runs and never persisted: the sequence has to be
    // entered again, every run, every reload.
    this.godMode = false;
    this.secretCode.reset();
    // Every upgrade roll for this run - level-up cards and treasure caches
    // alike - now leans toward this character's build. Set once here rather
    // than passed down through each call site.
    this.upgradeSystem.setAffinities(this.selectedCharacter.affinities);
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
    const st = this.state.stats;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const stats: PauseStatEntry[] = [
      { label: t('Vida'), value: `${Math.ceil(Math.max(0, st.health))}/${Math.ceil(st.maxHealth)}` },
      { label: t('Daño'), value: pct(st.damageMultiplier) },
      { label: t('Área'), value: pct(st.areaMultiplier) },
      // Cooldown is stored as a multiplier where lower is better; the player
      // thinks in "attack speed", so show the gain rather than the raw value.
      { label: t('Cadencia'), value: `+${Math.max(0, Math.round((1 - st.cooldownMultiplier) * 100))}%` },
      { label: t('Velocidad'), value: st.moveSpeed.toFixed(1) },
      { label: t('Crítico'), value: pct(st.critChance) },
      { label: t('Blindaje'), value: `${st.armor}` },
      { label: t('Regen'), value: `${st.regenPerSecond.toFixed(1)}/s` },
      { label: t('Imán'), value: st.magnetRadius.toFixed(1) },
      { label: t('Suerte'), value: pct(st.luck) },
    ];
    return { characterName: this.selectedCharacter.name, level: this.state.run.level, weapons, passives, stats };
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
    this.pickups.clear();
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

    resizeRenderer(this.renderer, this.camera, this.showcaseViewHeight || CAMERA.viewHeight);

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
      // Showcase mode (see the `enemyShowcase` hook) suspends wave spawning
      // and weapon fire so the inspection lineup isn't buried by a horde or
      // shot to pieces mid-comparison. Enemies themselves keep updating, so
      // their animations still run.
      if (!this.showcaseMode && this.waveSpawningEnabled) {
        this.waveDirector.update(animDelta, this.state.run.elapsed, this.player.position.x, this.player.position.z, this.state.stats.luck);
      }

      const { contactDamage } = this.enemies.update(animDelta, this.player.position.x, this.player.position.z);

      this.weaponSystem.trySetInventory(this.state.ownedPassives);
      if (!this.showcaseMode) {
        this.weaponSystem.update(
          animDelta,
          this.state.run.elapsed,
          this.player.position.x,
          this.player.position.z,
          this.player.velocity.x,
          this.player.velocity.z,
          this.state.stats,
          // World Y of this character's weapon hand, so hand-originating
          // visuals (the whip cord) leave the body at the right height.
          LAYER_Y.player + this.selectedCharacter.castAnchor * 1.5,
        );
      }
      this.projectiles.update(animDelta);
      // Drives the ground-zone wave animation and decays per-zone tick pulses.
      this.groundRings.update(animDelta);
      this.worldProps.update(animDelta, this.player.position.x, this.player.position.z, () => this.rng());
      // Wider magnet than gems: a relic sliding into reach is part of the
      // reward, and chasing one through a horde is not interesting.
      this.pickups.update(animDelta, this.player.position.x, this.player.position.z, this.state.stats.magnetRadius * 1.35 + 0.8, 0.85);

      // Push the player out of solid props AFTER movement integration, using
      // minimum-translation so diagonal contact slides along the surface
      // instead of stopping dead or jittering.
      if (this.worldProps.resolve(this.player.position.x, this.player.position.z, PLAYER.radius, this.collideScratch)) {
        this.player.position.x = this.collideScratch.x;
        this.player.position.z = this.collideScratch.z;
      }

      // Breakables take damage from whatever weapon geometry reaches them -
      // the player never has to aim at a prop.
      this.sweepPropDamage();

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

    // While showcasing, hold the camera on the lineup's centre rather than
    // following the player, so every row stays framed.
    this.cameraRig.update(delta, this.showcaseMode ? SHOWCASE_CAMERA_TARGET : this.player.position);
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
    // "Ready to evolve" is part of the signature: the slot has to re-render
    // the moment the gating passive is picked up, not only when a level changes.
    const readyIds = new Set(
      owned
        .filter((w) => {
          if (w.evolved || w.level < w.maxLevel) return false;
          const required = WEAPON_EVOLUTION_PASSIVE_ID[w.id];
          return !required || (this.state.ownedPassives.get(required) ?? 0) > 0;
        })
        .map((w) => w.id),
    );
    const signature = owned.map((w) => `${w.id}:${w.level}:${w.evolved ? 1 : 0}:${readyIds.has(w.id) ? 1 : 0}`).join('|');
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
      const ready = readyIds.has(weapon.id);
      slot.root.className =
        `hud-power-slot hud-power-slot--filled` +
        (weapon.evolved ? ' hud-power-slot--evolved' : '') +
        (ready ? ' hud-power-slot--ready' : '');
      slot.root.title = weapon.evolved
        ? `${t(weapon.name)} — ${t('evolucionado')}`
        : ready
          ? `${t(weapon.name)} — ${t('listo para evolucionar')}`
          : `${t(weapon.name)} Lv${weapon.level}`;
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

  /**
   * Toggles immortality. Deliberately never says so: the two lines below are
   * the only feedback, they last about a second and a half, and nothing
   * persists them or shows a permanent indicator. The state itself lives in
   * `godMode`, which `applyPlayerDamage` checks BEFORE touching HP, so damage
   * is refused rather than healed back.
   *
   * Offensive numbers are untouched on purpose - this is immortality, not a
   * damage cheat, so builds still play out normally while testing.
   */
  private toggleVeil(): void {
    this.godMode = !this.godMode;
    this.showVeilToast(this.godMode ? 'The veil no longer binds you.' : 'The veil closes.');
  }

  /**
   * The secret's own feedback: small, italic, centred, gone in ~1.5s.
   * Deliberately NOT the gold minute/pickup toast - that box announces things
   * the game wants you to notice.
   */
  private showVeilToast(text: string): void {
    if (!this.veilToastEl) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;top:38%;left:50%;transform:translate(-50%,-50%);' +
        'color:rgba(232,221,199,0.82);font-family:Georgia,"Times New Roman",serif;' +
        'font-style:italic;font-size:0.95rem;letter-spacing:0.06em;'+
        // #hud uppercases everything; this line is quoted prose, not a label.
        'text-transform:none;font-weight:400;' +
        'text-shadow:0 0 12px rgba(0,0,0,0.95), 1px 1px 0 rgba(0,0,0,0.9);' +
        'pointer-events:none;opacity:0;transition:opacity 0.45s ease;z-index:6;';
      this.getElement('#hud').appendChild(el);
      this.veilToastEl = el;
    }
    const el = this.veilToastEl;
    el.textContent = text;
    el.style.opacity = '1';
    if (this.veilToastTimer !== undefined) window.clearTimeout(this.veilToastTimer);
    this.veilToastTimer = window.setTimeout(() => {
      el.style.opacity = '0';
    }, 1500);
  }

  /** Generic reusable version of the toast above - same box, any message. */
  /**
   * Applies a collected pickup. Lives here rather than in PickupManager on
   * purpose: every effect reaches into a different system (state, gems,
   * enemies, audio), and the director is the only place that already owns all
   * of them.
   */
  private applyPickup(kind: PickupKind, x: number, z: number): void {
    const def = findDrop(kind);
    const label = t(def?.name ?? kind);
    this.particles.spawnBurst(x, z, { count: 8, colorHex: '#ffe9a8', speed: 2.6, life: 0.3 });
    gameEvents.emit('screenShake', { intensity: 0.05, duration: 0.08 });

    switch (kind) {
      case 'gold':
        // Gold itself is credited by MetaProgression, which owns the
        // permanent gold multiplier; nothing to do here but announce it.
        this.showToast(`${t('GOLD')} +${GOLD_PICKUP_VALUE}`);
        break;

      case 'ration': {
        const before = this.state.stats.health;
        this.state.stats.health = Math.min(this.state.stats.maxHealth, this.state.stats.health + RATION_HEAL);
        const healed = Math.round(this.state.stats.health - before);
        this.showToast(healed > 0 ? `${label} +${healed} HP` : `${label} — ${t('full health')}`);
        break;
      }

      case 'vacuum': {
        // Pull every loose gem in, without teleporting them: flipping the
        // magnet flag reuses the gems' own inbound motion and their collect
        // path, so XP, level-ups and VFX all fire exactly as normal.
        let pulled = 0;
        for (let i = 0; i < this.gems.capacity; i++) {
          if (!this.gems.alive[i] || this.gems.magnetized[i]) continue;
          this.gems.magnetized[i] = 1;
          pulled++;
        }
        this.showToast(`${label} — ${pulled} ${t('souls')}`);
        break;
      }

      case 'freeze': {
        const n = this.enemies.freezeAll(FREEZE_SECONDS);
        this.showToast(`${label} — ${n} ${t('frozen')}`);
        break;
      }

      case 'purge': {
        // Deliberately routed through the ordinary damage API rather than
        // clearing arrays: kills, gem drops, the damage ledger and every death
        // VFX must behave exactly as if the player had earned them.
        let killed = 0;
        for (let i = 0; i < this.enemies.capacity; i++) {
          if (!this.enemies.alive[i] || this.enemies.isBoss[i]) continue;
          if (this.enemies.damage(i, PURGE_DAMAGE, false, 'purge')) killed++;
        }
        gameEvents.emit('screenShake', { intensity: 0.32, duration: 0.35 });
        this.showToast(`${label} — ${killed} ${t('purged')}`);
        break;
      }

      case 'fortune':
        this.state.stats.luck = Math.min(1, this.state.stats.luck + FORTUNE_LUCK);
        this.showToast(`${label} — +${Math.round(FORTUNE_LUCK * 100)}% ${t('luck')}`);
        break;
    }
  }

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
    // A thrown axe finishing its arc kicks up dust where it lands, which is
    // what makes the parabola resolve instead of the axe just vanishing.
    // Breakable destroyed: a few cheap pooled fragments, no rigid bodies.
    gameEvents.on('propDestroyed', (e) => {
      this.particles.spawnBurst(e.x, e.z, { count: 6, colorHex: e.color, speed: 3.4, life: 0.42 });
      // Every breakable rolls the shared drop table. Level gates and luck live
      // in the table itself, so this stays one line and stays tunable.
      const drop = rollDrop(() => this.rng(), this.state.stats.luck, this.state.run.level);
      if (drop) this.pickups.spawn(e.x, e.z, drop.id);
    });
    gameEvents.on('pickupCollected', (e) => this.applyPickup(e.kind as PickupKind, e.x, e.z));
    gameEvents.on('weaponImpact', (e) => {
      this.particles.spawnBurst(e.x, e.z, { count: 7, colorHex: '#b9a98a', speed: 2.4, life: 0.32 });
    });
    gameEvents.on('enemyHit', (e) => {
      this.state.run.damageDealt += e.damage;
      // Per-weapon damage ledger for the run summary. A plain Map keyed by
      // weapon id - at most 6 entries, written once per hit, so it costs
      // nothing next to the damage calculation that produced the number.
      if (e.weaponId) this.damageByWeapon.set(e.weaponId, (this.damageByWeapon.get(e.weaponId) ?? 0) + e.damage);
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
      const meta = getWeaponMetadata(e.weaponId);
      this.ui.showEvolution({
        id: e.weaponId,
        fromName: meta?.name ?? e.name,
        toName: meta?.evolvedName ?? e.name,
      });

    });
    gameEvents.on('runOver', (e) => {
      const stats = {
        survivedSeconds: e.survivedSeconds,
        kills: e.kills,
        level: e.level,
        goldEarned: Math.max(0, this.metaProgression.gold - this.goldAtRunStart),
        damageByPower: this.buildDamageBreakdown(),
      };
      // A run can end while another overlay is still open - a pending
      // level-up the player had not resolved, or the pause screen. Close both
      // first, otherwise the panels stack and the dead one is still visible
      // (and clickable) behind the results.
      this.ui.hideUpgradePicker();
      this.ui.hidePause();
      this.pendingLevelUps = 0;
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
      // QA helper: spawn one enemy at an exact (playerX + dx, playerZ + dz)
      // offset, for tests that need precise placement (e.g. "one enemy
      // directly north of the player") instead of spawnEnemies' random ring.
      spawnEnemyAt: (dx: number, dz: number, typeName?: keyof EnemyTypeIds) => {
        const typeId = typeName && typeName in this.enemyTypes ? this.enemyTypes[typeName] : this.enemyTypes.grunt;
        return this.enemies.spawn(typeId, this.player.position.x + dx, this.player.position.z + dz);
      },
      // QA helper: read back an enemy's current/max HP by pool index (as returned by spawnEnemyAt) to verify a specific enemy actually took (or didn't take) damage.
      getEnemyHp: (index: number) => ({ hp: this.enemies.hp[index] ?? -1, maxHp: this.enemies.maxHp[index] ?? -1, alive: this.enemies.alive[index] === 1 }),
      // QA helper: current velocity vectors of every live projectile belonging to a given weapon id, so a test can assert a weapon's launch angle directly instead of inferring it from enemy damage/position.
      getProjectileVelocities: (weaponId: string) => {
        const numericId = this.weaponSystem.getWeaponNumericId(weaponId);
        const out: Array<{ vx: number; vz: number }> = [];
        if (numericId === -1) return out;
        for (let i = 0; i < this.projectiles.capacity; i++) {
          if (this.projectiles.alive[i] && this.projectiles.weaponId[i] === numericId) {
            out.push({ vx: this.projectiles.velX[i], vz: this.projectiles.velZ[i] });
          }
        }
        return out;
      },
      /**
       * QA helper: hurt the player through the real damage path.
       *
       * By default it respects everything that path respects, god mode
       * included - a helper that silently ignored immortality would make the
       * immortality tests meaningless. Pass `force` to set up a wounded
       * player regardless: that lifts god mode and the post-hit i-frames for
       * the single call, then restores them.
       */
      damagePlayer: (amount: number, force = false) => {
        if (!force) {
          this.applyPlayerDamage(amount);
          return;
        }
        const wasGod = this.godMode;
        this.godMode = false;
        this.player.invulnTimer = 0;
        this.applyPlayerDamage(amount);
        this.godMode = wasGod;
      },
      /** QA helper: kill every live enemy through the normal death path, so gems/kills are credited. */
      killAllEnemies: () => {
        let n = 0;
        for (let i = 0; i < this.enemies.capacity; i++) {
          if (this.enemies.alive[i] && this.enemies.damage(i, 1e9)) n++;
        }
        return n;
      },
      /** QA helper: every live world prop (solid + breakable) with its collision box. */
      listWorldProps: () => this.worldProps.list(),
      /**
       * QA helper: destroy the breakable nearest the player, exactly as a
       * weapon would - it runs through damageArea, so the drop roll, particles
       * and events all fire normally. Returns how many pickups exist after.
       */
      breakNearestProp: () => {
        const props = this.worldProps.list().filter((p) => p.category === 1 && p.hp > 0);
        if (props.length === 0) return { broke: false, pickups: this.pickups.list() };
        let best = props[0];
        let bestD = Infinity;
        for (const p of props) {
          const d = (p.x - this.player.position.x) ** 2 + (p.z - this.player.position.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        this.worldProps.damageArea(best.x, best.z, Math.max(best.halfW, best.halfD) + 0.5, 99999);
        return { broke: true, x: best.x, z: best.z, pickups: this.pickups.list() };
      },
      /** QA helper: live pickups in the world. */
      listPickups: () => this.pickups.list(),
      /** QA helper: drop a specific pickup next to the player, to test its effect deterministically. */
      spawnPickup: (kind: string, dx = 1.5, dz = 0) =>
        this.pickups.spawn(this.player.position.x + dx, this.player.position.z + dz, kind as PickupKind),
      /** QA helper: how many enemies are currently frozen by the Sepulchral Frost pickup. */
      getFrozenCount: () => {
        let n = 0;
        for (let i = 0; i < this.enemies.capacity; i++) {
          if (this.enemies.alive[i] && this.enemies.freezeTimer[i] > 0) n++;
        }
        return n;
      },
      /** QA helper: how many loose XP gems are currently magnetised toward the player. */
      getMagnetizedGemCount: () => {
        let n = 0;
        for (let i = 0; i < this.gems.capacity; i++) {
          if (this.gems.alive[i] && this.gems.magnetized[i]) n++;
        }
        return n;
      },
      /**
       * QA helper: roll the real upgrade pool N times under a given
       * character's affinities, against the CURRENT run state, and return the
       * option-id histogram. Because the game state is held fixed, the only
       * thing that changes between two calls is the affinity table - which is
       * exactly what a distribution test needs to isolate. Restores whatever
       * affinities the live run was using.
       */
      simulateUpgradeRolls: (characterId: string | null, rolls: number, count = 3) => {
        const character = characterId ? CHARACTERS.find((c) => c.id === characterId) : null;
        if (characterId && !character) {
          console.warn(`Unknown character id: ${characterId}`);
          return {};
        }
        const previous = this.selectedCharacter.affinities;
        this.upgradeSystem.setAffinities(character ? character.affinities : null);
        // Deterministic stream so two calls differ only by the affinity table.
        let seed = 2463534242;
        const rng = () => {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          seed >>>= 0;
          return seed / 4294967296;
        };
        const histogram: Record<string, number> = {};
        for (let i = 0; i < rolls; i++) {
          for (const option of this.upgradeSystem.rollChoices(rng, this.state.ownedPassives, count, 0, false)) {
            histogram[option.id] = (histogram[option.id] ?? 0) + 1;
          }
        }
        this.upgradeSystem.setAffinities(previous);
        return histogram;
      },
      /** QA helper: a character's starting weapon id, so a test never has to hardcode the roster. */
      getCharacterStartWeapon: (characterId: string) =>
        CHARACTERS.find((c) => c.id === characterId)?.startWeaponId ?? '',
      /** QA helper: the affinity table a character actually carries. */
      getCharacterAffinities: (characterId: string) => {
        const character = CHARACTERS.find((c) => c.id === characterId);
        return character ? character.affinities : null;
      },
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
      enemyShowcase: (opts) => this.enterEnemyShowcase(opts ?? {}),
      /**
       * Power inspection: isolate ONE weapon at a given level (or evolved)
       * with a ring of dummy targets to shoot at, so its pattern, count,
       * direction, reach and VFX can be captured reproducibly at each
       * milestone - the weapon equivalent of `enemyShowcase`.
       */
      powerShowcase: (weaponId: string, level: number | 'evolved') => {
        if (this.state.phase !== 'playing') this.beginRun();
        this.showcaseMode = false; // weapons MUST run - they are the subject
        this.godMode = true;
        this.enemies.clear();
        this.waveSpawningEnabled = false;

        this.weaponSystem.reset(weaponId);
        const targetLevel = level === 'evolved' ? 8 : Math.max(1, Math.min(8, level));
        for (let i = 1; i < targetLevel; i++) this.weaponSystem.levelUp(weaponId);
        if (level === 'evolved') this.weaponSystem.forceEvolve(weaponId);

        // Park the player at the origin and ring it with stationary, very
        // high-HP dummies so the weapon has something to target and hit
        // without the lineup dissolving mid-capture.
        this.player.position.set(0, LAYER_Y.player, 0);
        this.player.velocity.set(0, 0, 0);
        this.cameraRig.snapTo(SHOWCASE_CAMERA_TARGET);
        const ring = 12;
        for (let i = 0; i < ring; i++) {
          const a = (i / ring) * Math.PI * 2;
          const d = 4.5 + (i % 3) * 1.6;
          const idx = this.enemies.spawn(this.enemyTypes.grunt, Math.cos(a) * d, Math.sin(a) * d, { hpMult: 4000 });
          if (idx !== -1) this.enemies.frozen[idx] = 1;
        }
        this.showcaseViewHeight = 22;
        const w = this.weaponSystem.listOwned().find((x) => x.id === weaponId);
        return { id: weaponId, level: w?.level ?? 0, evolved: w?.evolved ?? false, effect: effectAt(weaponId, w?.level ?? 1, w?.evolved ?? false) };
      },
      /** QA helper: live projectile census by weapon, for asserting counts/patterns from a test. */
      /**
       * QA helper: live projectiles of a weapon WITH their projected screen
       * position. Screen space is the only place the arc can actually be
       * verified - a world-space parabola in the wrong axis still reads as a
       * straight climb, which is exactly how the axe regressed before.
       * screenY is in pixels, y-down (0 = top), so rising = DECREASING.
       */
      getProjectileScreenPositions: (weaponId: string) => {
        const numericId = this.weaponSystem.getWeaponNumericId(weaponId);
        const out: Array<{ index: number; x: number; y: number; z: number; screenX: number; screenY: number }> = [];
        if (numericId === -1) return out;
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        for (let i = 0; i < this.projectiles.capacity; i++) {
          if (!this.projectiles.alive[i] || this.projectiles.weaponId[i] !== numericId) continue;
          const y = LAYER_Y.projectile + this.projectiles.heightOffset[i];
          SCREEN_PROBE.set(this.projectiles.posX[i], y, this.projectiles.posZ[i]);
          SCREEN_PROBE.project(this.camera);
          out.push({
            index: i,
            x: this.projectiles.posX[i],
            y,
            z: this.projectiles.posZ[i],
            screenX: (SCREEN_PROBE.x * 0.5 + 0.5) * w,
            screenY: (-SCREEN_PROBE.y * 0.5 + 0.5) * h,
          });
        }
        return out;
      },
      getProjectileCensus: (weaponId: string) => {
        const numericId = this.weaponSystem.getWeaponNumericId(weaponId);
        const out: Array<{ x: number; z: number; vx: number; vz: number; radius: number }> = [];
        if (numericId === -1) return out;
        for (let i = 0; i < this.projectiles.capacity; i++) {
          if (this.projectiles.alive[i] && this.projectiles.weaponId[i] === numericId) {
            out.push({
              x: this.projectiles.posX[i],
              z: this.projectiles.posZ[i],
              vx: this.projectiles.velX[i],
              vz: this.projectiles.velZ[i],
              radius: this.projectiles.radius[i],
            });
          }
        }
        return out;
      },
      /**
       * QA helper: where the whip cord sits relative to the CURRENT
       * character's sprite, in world units. Lets the anchor be verified per
       * character by measurement instead of eyeballing six screenshots.
       */
      getWhipAnchorDebug: () => {
        const spriteHeight = 1.5; // Player.SPRITE_WORLD_SIZE
        const feetY = LAYER_Y.player;
        const cordY = feetY + this.selectedCharacter.castAnchor * spriteHeight;
        return {
          character: this.selectedCharacter.id,
          feetY,
          spriteTopY: feetY + spriteHeight,
          cordY,
          cordFractionOfHeight: (cordY - feetY) / spriteHeight,
        };
      },
      /** QA helper: radii of the ground rings actually being drawn this frame (Garlic aura, Hex Flask zones). */
      getGroundRingRadii: () => this.groundRings.activeRadii(),
      /** QA helper: the authoritative progression numbers the simulation uses at a level. */
      getWeaponEffect: (weaponId: string, level: number, evolved = false) => effectAt(weaponId, level, evolved),
      /** QA helper: what the level-up card will claim, derived from the same table. */
      getLevelDiff: (weaponId: string, from: number, to: number) => describeLevelUp(weaponId, from, to),
      setEnemyPose: (pose) => {
        const index = pose === null ? -1 : ENEMY_POSES.indexOf(pose as EnemyPose);
        if (pose !== null && index === -1) {
          console.warn(`Unknown enemy pose: ${pose}`);
          return;
        }
        for (let i = 0; i < this.enemies.capacity; i++) {
          if (this.enemies.alive[i]) this.enemies.forcedPose[i] = index;
        }
      },
      // QA helper: read back what pose each live enemy is ACTUALLY playing
      // right now. Lets a test assert that a telegraph really fires during
      // real gameplay (spitter charging, ghoul winding up its dash, boss
      // holding its attack wind-up) instead of only checking that the clips
      // exist in the atlas.
      getEnemyAnimStates: () => {
        const out: Array<{ name: string; pose: string; isBoss: boolean }> = [];
        for (let i = 0; i < this.enemies.capacity; i++) {
          if (!this.enemies.alive[i]) continue;
          const kind = this.enemies.poseKind[i];
          let pose: string;
          if (kind !== 255 && this.enemies.poseRemaining[i] > 0) {
            pose = ENEMY_POSES[kind];
          } else {
            const vx = this.enemies.velX[i];
            const vz = this.enemies.velZ[i];
            pose = vx * vx + vz * vz > 0.04 ? 'walk' : 'idle';
          }
          out.push({ name: this.enemies.getType(this.enemies.typeId[i]).name, pose, isBoss: this.enemies.isBoss[i] === 1 });
        }
        return out;
      },
      exitEnemyShowcase: () => {
        this.showcaseMode = false;
        this.showcaseViewHeight = 0;
        this.waveSpawningEnabled = true;
        this.enemies.clear();
      },
    };
  }

  /**
   * Art-inspection scene: parks one frozen instance of EVERY registered enemy
   * and boss type in a labelled grid with the player standing among them, so
   * scale, silhouette, shading, shadows and animation can be compared side by
   * side in one frame. Wave spawning and weapon fire are suspended and the
   * camera zooms out to fit the lineup.
   *
   * Returns the layout (type name + world position per slot) so a capture
   * script can annotate the screenshot without re-deriving the grid.
   */
  private enterEnemyShowcase(opts: { pose?: string; columns?: number; spacing?: number; viewHeight?: number; only?: string[] }): Array<{ name: string; x: number; z: number }> {
    if (this.state.phase !== 'playing') this.beginRun();
    this.showcaseMode = true;
    this.godMode = true;
    this.enemies.clear();

    const fullOrder: Array<keyof EnemyTypeIds> = [
      'grunt', 'bat', 'skeleton', 'slime', 'wolf',
      'ghost', 'brute', 'spitter', 'ghoul', 'gargoyle',
      'rotKing', 'boneColossus', 'duskfang',
    ];
    // `only` narrows the lineup to a handful of types so the camera can pull
    // right in on them - the whole-roster view is for comparing scale, this
    // is for judging pixel craft on individual creatures.
    const order = opts.only?.length
      ? fullOrder.filter((k) => opts.only!.includes(k))
      : fullOrder;
    const columns = opts.columns ?? 5;
    const spacing = opts.spacing ?? 5.5;
    const rowGap = spacing * 1.15;
    // Player occupies slot 0 so it is directly comparable against the roster.
    const totalSlots = order.length + 1;
    const rows = Math.ceil(totalSlots / columns);
    const originX = -((columns - 1) * spacing) / 2;
    const originZ = -((rows - 1) * rowGap) / 2;
    const slotPos = (slot: number) => ({
      x: originX + (slot % columns) * spacing,
      z: originZ + Math.floor(slot / columns) * rowGap,
    });

    const layout: Array<{ name: string; x: number; z: number }> = [];
    const playerSlot = slotPos(0);
    this.player.position.set(playerSlot.x, LAYER_Y.player, playerSlot.z);
    this.player.velocity.set(0, 0, 0);
    this.cameraRig.snapTo(new THREE.Vector3(0, 0, 0));
    layout.push({ name: `player:${this.selectedCharacter.name}`, x: playerSlot.x, z: playerSlot.z });

    const poseIndex = opts.pose ? ENEMY_POSES.indexOf(opts.pose as EnemyPose) : -1;
    order.forEach((key, k) => {
      const { x, z } = slotPos(k + 1);
      const isBoss = key === 'rotKing' || key === 'boneColossus' || key === 'duskfang';
      const index = this.enemies.spawn(this.enemyTypes[key], x, z, isBoss ? { boss: true } : undefined);
      if (index === -1) return;
      this.enemies.frozen[index] = 1;
      this.enemies.facing[index] = 1;
      this.enemies.spawnTimer[index] = 0; // skip the pop-in so the first frame is already correct
      if (poseIndex >= 0) this.enemies.forcedPose[index] = poseIndex;
      layout.push({ name: this.enemies.getType(this.enemyTypes[key]).name, x, z });
    });

    // Frame the whole grid with a margin, unless the caller pins a value.
    this.showcaseViewHeight = opts.viewHeight ?? Math.max(20, rows * rowGap + 14);
    return layout;
  }

  /** Ranked damage share per weapon, biggest first, for the run summary. */
  /**
   * Sweeps live projectiles against breakable props. This covers ten of the
   * eleven weapons for free, because their hitboxes ARE projectiles (bolts,
   * knives, axes, crosses, shards, flasks, orbiter blades, even the whip's
   * lash instance). Garlic, the one pure-aura weapon, reports its own tick
   * separately - see the groundRings pulse path.
   */
  private sweepPropDamage(): void {
    for (let i = 0; i < this.projectiles.capacity; i++) {
      if (!this.projectiles.alive[i] || this.projectiles.weaponId[i] < 0) continue;
      // The whip's lash and the orbiter's blades carry damage 0 (their weapons
      // apply damage directly), so fall back to a flat value - breakables have
      // 10-14 HP and are meant to pop after a couple of contacts.
      const dmg = this.projectiles.damage[i] > 0 ? this.projectiles.damage[i] : 7;
      this.worldProps.damageArea(this.projectiles.posX[i], this.projectiles.posZ[i], Math.max(0.5, this.projectiles.radius[i]), dmg);
    }

    // Garlic is the one weapon with no projectile at all, so its aura is
    // applied explicitly here at exactly the radius it damages enemies with.
    const garlic = this.weaponSystem.listOwned().find((w) => w.id === 'garlic_aura');
    if (garlic) {
      const e = effectAt('garlic_aura', garlic.level, garlic.evolved);
      const radius = (e.radius ?? 2.2) * this.state.stats.areaMultiplier;
      this.worldProps.damageArea(this.player.position.x, this.player.position.z, radius, e.damage * 0.6);
    }
  }

  private buildDamageBreakdown(): Array<{ id: string; name: string; percent: number }> {
    let total = 0;
    for (const v of this.damageByWeapon.values()) total += v;
    if (total <= 0) return [];
    return Array.from(this.damageByWeapon.entries())
      .map(([id, amount]) => ({
        id,
        name: getWeaponMetadata(id)?.name ?? id,
        percent: (amount / total) * 100,
      }))
      .sort((a, b) => b.percent - a.percent);
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
      pickupCount: this.pickups.activeCount,
      // Exposed for QA: luck is invisible in the HUD by design, but drop-rate
      // and fortune-coin behaviour can only be asserted against the real value.
      luck: this.state.stats.luck,
      // Development/testing only. There is deliberately no UI for this.
      godMode: this.godMode,
      particleCount: 0,
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      // Number of distinct sprite cells packed into the shared atlas. Worth
      // watching after an art pass: the atlas is a square sqrt-packing at
      // 64px per cell, so this is what drives its texture memory.
      atlasCells: spriteAtlas.debugCellCount,
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
