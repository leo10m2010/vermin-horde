import type { CharacterDef } from '../game/Characters';
import { drawCharacterPortrait } from '../render/SpriteLibraryCharacters';
import { createDefaultStats } from '../game/GameState';
import type { PlayerStats } from '../game/GameState';
import { getWeaponMetadata } from '../weapons/WeaponMetadata';
import { getUpgradeIconDataUrl } from './Icons';
import { t } from '../i18n';

const STYLE_ID = 'character-select-styles';
const ROSTER_PORTRAIT_SIZE = 56;
const PREVIEW_PORTRAIT_SIZE = 192;
const PREVIEW_FADE_MS = 150;

type Difficulty = 'easy' | 'medium' | 'hard';

// Hand-reasoned per the actual feel of each trait (Vex's fragile burst plays
// harder than Brakka's flat tankiness even though neither trait is "bigger"
// on paper). Falls back to difficultyOf()'s heuristic for any character not
// yet listed here, so a future roster addition never breaks.
const DIFFICULTY_BY_CHARACTER_ID: Record<string, Difficulty> = {
  thornguard: 'easy',
  steadyhand: 'easy',
  warden: 'medium',
  cinderborn: 'medium',
  fortune: 'medium',
  redline: 'hard',
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Fácil',
  medium: 'Media',
  hard: 'Difícil',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Comparative 0-100 bar fill for a raw stat value against a reasonable expected range across the roster. Not meant to be exact - just a readable side-by-side comparison. */
function normalize(value: number, min: number, max: number): number {
  return clamp01((value - min) / (max - min)) * 100;
}

/** Same as normalize() but inverted - for stats where a LOWER raw value is the better outcome (e.g. cooldownMultiplier, where lower = faster attacks). */
function normalizeInverted(value: number, min: number, max: number): number {
  return clamp01((max - value) / (max - min)) * 100;
}

/** One-shot reference stats for a character: default baseline + its applyTrait() bonus. Purely for preview numbers - never touches real run state. */
function referenceStats(character: CharacterDef): PlayerStats {
  const stats = createDefaultStats();
  character.applyTrait(stats);
  return stats;
}

/** Heuristic fallback for any character id not in DIFFICULTY_BY_CHARACTER_ID: low health + high speed/crit reads as more demanding to play. */
function difficultyOf(character: CharacterDef, stats: PlayerStats): Difficulty {
  const known = DIFFICULTY_BY_CHARACTER_ID[character.id];
  if (known) return known;
  const healthPct = clamp01((stats.maxHealth - 70) / 90);
  const speedPct = clamp01((stats.moveSpeed - 5) / 4);
  const critPct = clamp01((stats.critChance - 0.02) / 0.28);
  const score = (1 - healthPct) * 0.5 + speedPct * 0.25 + critPct * 0.25;
  if (score < 0.35) return 'easy';
  if (score < 0.6) return 'medium';
  return 'hard';
}

/** Generic "snake_case -> Title Case" fallback for a weapon id missing from WEAPON_METADATA, so the preview never shows a raw id. */
function fallbackWeaponName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatBarDef {
  label: string;
  pct: number;
  display: string;
}

function buildStatBars(stats: PlayerStats): StatBarDef[] {
  return [
    { label: t('Vida'), pct: normalize(stats.maxHealth, 70, 160), display: `${Math.round(stats.maxHealth)}` },
    { label: t('Velocidad'), pct: normalize(stats.moveSpeed, 5, 9), display: stats.moveSpeed.toFixed(1) },
    {
      label: t('Daño'),
      pct: normalize(stats.damageMultiplier, 0.85, 1.3),
      display: `${Math.round(stats.damageMultiplier * 100)}%`,
    },
    {
      label: t('Área'),
      pct: normalize(stats.areaMultiplier, 0.85, 1.3),
      display: `${Math.round(stats.areaMultiplier * 100)}%`,
    },
    {
      label: t('Cadencia'),
      pct: normalizeInverted(stats.cooldownMultiplier, 0.85, 1.15),
      display: `+${Math.max(0, Math.round((1 - stats.cooldownMultiplier) * 100))}%`,
    },
    {
      label: t('Crítico'),
      pct: normalize(stats.critChance, 0.02, 0.3),
      display: `${Math.round(stats.critChance * 100)}%`,
    },
  ];
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #character-select-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      padding: 24px;
      background: radial-gradient(ellipse at center, rgba(22, 8, 7, 0.6) 0%, rgba(4, 2, 2, 0.93) 100%);
      pointer-events: auto;
      z-index: 20;
      color: var(--gh-parchment, #e8ddc7);
      font-family: 'Segoe UI', Avenir, sans-serif;
    }
    #character-select-overlay[hidden] {
      display: none !important;
      pointer-events: none;
    }
    .cs-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 980px;
      padding: 26px 30px 30px;
      background: linear-gradient(180deg, var(--gh-panel-bg-top, #1c100d), var(--gh-panel-bg-bottom, #0c0605));
      border: 2px solid var(--gh-red, #8a0303);
      border-radius: 4px;
      box-shadow:
        inset 0 0 0 1px var(--gh-gold-dim, rgba(201, 162, 39, 0.4)),
        inset 0 0 40px rgba(0, 0, 0, 0.5),
        0 18px 60px rgba(0, 0, 0, 0.65);
    }
    .cs-panel-corners {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .cs-corner {
      position: absolute;
      width: 13px;
      height: 13px;
      background: linear-gradient(135deg, var(--gh-gold-bright, #e8c468), var(--gh-red-bright, #b8121f));
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.7);
      transform: rotate(45deg);
    }
    .cs-corner--tl { top: -7px; left: -7px; }
    .cs-corner--tr { top: -7px; right: -7px; }
    .cs-corner--bl { bottom: -7px; left: -7px; }
    .cs-corner--br { bottom: -7px; right: -7px; }

    .cs-topbar {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .cs-back {
      appearance: none;
      flex: 0 0 auto;
      padding: 8px 14px;
      background: linear-gradient(180deg, #2b1614, #150a08);
      border: 1px solid var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      border-radius: 3px;
      color: var(--gh-parchment, #e8ddc7);
      font-family: var(--gh-serif, Georgia, serif);
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      cursor: pointer;
      outline: none;
      transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
    }
    .cs-back:hover {
      border-color: var(--gh-gold-bright, #e8c468);
      box-shadow: 0 0 14px rgba(184, 18, 31, 0.4);
      transform: translateY(-1px);
    }
    .cs-back:focus-visible {
      border-color: var(--gh-gold-bright, #e8c468);
      outline: 2px solid var(--gh-gold-bright, #e8c468);
      outline-offset: 2px;
    }
    .cs-heading {
      margin: 0;
      flex: 1;
      font-family: var(--gh-serif, Georgia, serif);
      font-weight: 700;
      font-size: 1.4rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--gh-gold-bright, #e8c468);
      text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.8), 0 0 16px rgba(184, 18, 31, 0.35);
      text-align: center;
    }
    .cs-subtitle {
      margin: -8px 0 0;
      text-align: center;
      font-family: var(--gh-serif, Georgia, serif);
      font-style: italic;
      font-size: 0.85rem;
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
    }

    .cs-layout {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }

    .cs-roster {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 60vh;
      overflow-y: auto;
      padding-right: 4px;
    }

    .cs-roster-item {
      appearance: none;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      background: rgba(232, 221, 199, 0.04);
      border: 1px solid var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      border-radius: 4px;
      color: var(--gh-parchment, #e8ddc7);
      text-align: left;
      cursor: pointer;
      font-family: inherit;
      outline: none;
      transition: border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
    }
    .cs-roster-item:hover {
      border-color: var(--gh-gold-bright, #e8c468);
      background: rgba(201, 162, 39, 0.08);
      transform: translateX(2px);
    }
    .cs-roster-item:focus-visible {
      outline: 2px solid var(--gh-gold-bright, #e8c468);
      outline-offset: 2px;
    }
    .cs-roster-item.is-selected {
      border-color: var(--gh-red-bright, #b8121f);
      background: linear-gradient(90deg, rgba(138, 3, 3, 0.32), rgba(138, 3, 3, 0.08));
      box-shadow: 0 0 16px rgba(184, 18, 31, 0.35), inset 0 0 0 1px var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
    }
    .cs-roster-portrait {
      flex: 0 0 auto;
      width: 44px;
      height: 44px;
      image-rendering: pixelated;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.55));
    }
    .cs-roster-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .cs-roster-name {
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cs-roster-diff {
      align-self: flex-start;
      padding: 1px 7px;
      border-radius: 8px;
      font-size: 0.6rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border: 1px solid transparent;
    }
    .cs-roster-diff--easy {
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
      border-color: var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
    }
    .cs-roster-diff--medium {
      color: var(--gh-gold-bright, #e8c468);
      border-color: var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      background: rgba(201, 162, 39, 0.12);
    }
    .cs-roster-diff--hard {
      color: var(--gh-red-glow, #d9403a);
      border-color: rgba(217, 64, 58, 0.5);
      background: rgba(138, 3, 3, 0.18);
    }

    .cs-preview {
      position: relative;
      min-height: 420px;
      padding: 22px 26px;
      background: linear-gradient(180deg, rgba(28, 16, 13, 0.55), rgba(10, 5, 4, 0.7));
      border: 1px solid var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      border-radius: 4px;
      box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.4);
    }

    .cs-preview-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      text-align: center;
      opacity: 1;
      transform: translateY(0);
      transition: opacity 0.16s ease, transform 0.16s ease;
    }
    .cs-preview-inner.cs-fade-out {
      opacity: 0;
      transform: translateY(6px);
    }

    .cs-preview-portrait-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${PREVIEW_PORTRAIT_SIZE}px;
      height: ${PREVIEW_PORTRAIT_SIZE}px;
      margin-bottom: 4px;
    }
    .cs-preview-portrait-wrap::before {
      content: '';
      position: absolute;
      inset: -14px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(184, 18, 31, 0.28), rgba(184, 18, 31, 0) 70%);
      z-index: 0;
    }
    .cs-preview-portrait {
      position: relative;
      z-index: 1;
      width: ${PREVIEW_PORTRAIT_SIZE}px;
      height: ${PREVIEW_PORTRAIT_SIZE}px;
      image-rendering: pixelated;
      filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.6));
    }

    .cs-preview-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cs-preview-name {
      margin: 0;
      font-family: var(--gh-serif, Georgia, serif);
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: var(--gh-parchment, #e8ddc7);
      text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.8);
    }
    .cs-preview-title-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .cs-preview-title {
      font-family: var(--gh-serif, Georgia, serif);
      font-style: italic;
      font-size: 0.85rem;
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
    }
    .cs-preview-diff {
      padding: 2px 9px;
      border-radius: 9px;
      font-size: 0.64rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1px solid transparent;
    }
    .cs-preview-diff--easy {
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
      border-color: var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
    }
    .cs-preview-diff--medium {
      color: var(--gh-gold-bright, #e8c468);
      border-color: var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      background: rgba(201, 162, 39, 0.12);
    }
    .cs-preview-diff--hard {
      color: var(--gh-red-glow, #d9403a);
      border-color: rgba(217, 64, 58, 0.5);
      background: rgba(138, 3, 3, 0.18);
    }

    .cs-preview-weapon {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: rgba(232, 221, 199, 0.05);
      border: 1px solid var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      border-radius: 4px;
    }
    .cs-preview-weapon-icon {
      width: 28px;
      height: 28px;
      image-rendering: pixelated;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.6));
    }
    .cs-preview-weapon-text {
      text-align: left;
    }
    .cs-preview-weapon-name {
      font-family: var(--gh-serif, Georgia, serif);
      font-size: 0.92rem;
      font-weight: 700;
      color: var(--gh-parchment, #e8ddc7);
    }
    .cs-preview-weapon-pattern {
      font-size: 0.68rem;
      font-style: italic;
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
    }

    .cs-preview-trait {
      margin: 0;
      max-width: 480px;
      font-size: 0.82rem;
      line-height: 1.45;
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
    }

    .cs-preview-stats {
      display: flex;
      flex-direction: column;
      gap: 7px;
      width: 100%;
      max-width: 420px;
      margin-top: 4px;
    }
    .cs-stat-row {
      display: grid;
      grid-template-columns: 78px 1fr 44px;
      align-items: center;
      gap: 10px;
    }
    .cs-stat-label {
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--gh-parchment-dim, rgba(232, 221, 199, 0.72));
      text-align: left;
    }
    .cs-stat-track {
      height: 8px;
      background: rgba(232, 221, 199, 0.1);
      border: 1px solid var(--gh-gold-dim, rgba(201, 162, 39, 0.4));
      border-radius: 4px;
      overflow: hidden;
    }
    .cs-stat-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--gh-red-bright, #b8121f), var(--gh-gold, #c9a227));
      transition: width 0.5s cubic-bezier(0.2, 0.7, 0.3, 1);
    }
    .cs-stat-value {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--gh-gold-bright, #e8c468);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .cs-confirm-btn {
      appearance: none;
      margin-top: 6px;
      padding: 12px 30px;
      border: 1px solid var(--gh-gold, #c9a227);
      border-radius: 3px;
      background: linear-gradient(180deg, var(--gh-red-bright, #b8121f), var(--gh-red, #8a0303) 70%, #4a0202);
      color: var(--gh-parchment, #e8ddc7);
      font-weight: 700;
      font-size: 0.86rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
      cursor: pointer;
      outline: none;
      transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
    }
    .cs-confirm-btn:hover {
      box-shadow: 0 0 20px rgba(184, 18, 31, 0.7), 0 0 10px rgba(201, 162, 39, 0.5);
      filter: brightness(1.08);
      transform: translateY(-1px);
    }
    .cs-confirm-btn:focus-visible {
      outline: 2px solid var(--gh-gold-bright, #e8c468);
      outline-offset: 2px;
    }
    .cs-confirm-btn:active {
      transform: translateY(0);
    }

    @media (max-width: 760px) {
      .cs-layout {
        grid-template-columns: 1fr;
      }
      .cs-roster {
        flex-direction: row;
        max-height: none;
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 4px;
      }
      .cs-roster-item {
        flex-direction: column;
        flex: 0 0 auto;
        width: 84px;
        text-align: center;
        gap: 6px;
      }
      .cs-roster-info {
        align-items: center;
      }
      .cs-preview {
        min-height: 0;
      }
      .cs-heading {
        font-size: 1.15rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .cs-preview-inner,
      .cs-stat-fill,
      .cs-roster-item,
      .cs-back,
      .cs-confirm-btn {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Self-contained character-select overlay. Mounts its own child element
 * directly into the shared #ui-root container (does not touch UiRoot.ts)
 * and injects its own <style> tag, so it never collides with the sibling
 * menu redesign happening on styles.css/UiRoot.ts this round.
 *
 * Layout: a compact vertical roster on the left (portrait + name + a
 * difficulty pill, click/tap or arrow keys to browse) and a large preview
 * panel on the right (big portrait, starting weapon, trait, and comparative
 * stat bars) that fades/slides between characters as the selection changes.
 * Browsing never commits - only the preview's confirm button, a roster
 * double-click, or Enter on a focused roster item actually picks a run.
 */
export class CharacterSelect {
  private readonly overlay: HTMLElement;
  private readonly rosterEl: HTMLElement;
  private readonly previewInner: HTMLElement;

  private characters: CharacterDef[] = [];
  private rosterButtons: HTMLButtonElement[] = [];
  private selectedIndex = 0;
  private previewRendered = false;

  constructor(
    root: HTMLElement,
    private readonly onChosen: (character: CharacterDef) => void,
    private readonly onBack?: () => void,
  ) {
    injectStyles();

    this.overlay = document.createElement('div');
    this.overlay.id = 'character-select-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'cs-panel';

    const corners = document.createElement('div');
    corners.className = 'cs-panel-corners';
    (['tl', 'tr', 'bl', 'br'] as const).forEach((pos) => {
      const corner = document.createElement('span');
      corner.className = `cs-corner cs-corner--${pos}`;
      corners.append(corner);
    });

    const topbar = document.createElement('div');
    topbar.className = 'cs-topbar';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'cs-back';
    backBtn.textContent = t('← Volver');
    backBtn.addEventListener('click', () => this.onBack?.());

    const heading = document.createElement('h2');
    heading.className = 'cs-heading';
    heading.textContent = t('Elige tu personaje');

    topbar.append(backBtn, heading);

    const subtitle = document.createElement('p');
    subtitle.className = 'cs-subtitle';
    subtitle.textContent = t('Cada personaje inicia con un arma distinta y un rasgo único para toda la partida.');

    const layout = document.createElement('div');
    layout.className = 'cs-layout';

    this.rosterEl = document.createElement('div');
    this.rosterEl.className = 'cs-roster';
    this.rosterEl.addEventListener('keydown', (event) => this.handleRosterKeydown(event));

    const previewPanel = document.createElement('div');
    previewPanel.className = 'cs-preview';
    this.previewInner = document.createElement('div');
    this.previewInner.className = 'cs-preview-inner';
    previewPanel.append(this.previewInner);

    layout.append(this.rosterEl, previewPanel);

    panel.append(corners, topbar, subtitle, layout);
    this.overlay.append(panel);
    root.append(this.overlay);
  }

  show(characters: CharacterDef[]): void {
    this.characters = characters;
    this.selectedIndex = 0;
    this.previewRendered = false;
    this.rosterButtons = [];
    this.rosterEl.replaceChildren(...characters.map((character, index) => this.buildRosterItem(character, index)));
    if (characters[0]) this.renderPreview(characters[0], false);
    this.overlay.hidden = false;
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  private buildRosterItem(character: CharacterDef, index: number): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'cs-roster-item';
    if (index === this.selectedIndex) {
      item.classList.add('is-selected');
      item.setAttribute('aria-current', 'true');
    } else {
      item.setAttribute('aria-current', 'false');
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'cs-roster-portrait';
    canvas.width = ROSTER_PORTRAIT_SIZE;
    canvas.height = ROSTER_PORTRAIT_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      drawCharacterPortrait(ctx, ROSTER_PORTRAIT_SIZE, character.spriteKey);
    }

    const info = document.createElement('div');
    info.className = 'cs-roster-info';

    const name = document.createElement('div');
    name.className = 'cs-roster-name';
    name.textContent = character.name;

    const stats = referenceStats(character);
    const diff = difficultyOf(character, stats);
    const diffPill = document.createElement('div');
    diffPill.className = `cs-roster-diff cs-roster-diff--${diff}`;
    diffPill.textContent = t(DIFFICULTY_LABEL[diff]);

    info.append(name, diffPill);
    item.append(canvas, info);

    item.addEventListener('click', () => this.select(index));
    item.addEventListener('dblclick', () => this.choose(index));

    this.rosterButtons.push(item);
    return item;
  }

  private select(index: number): void {
    if (index < 0 || index >= this.characters.length) return;
    if (index === this.selectedIndex && this.previewRendered) return;
    this.selectedIndex = index;
    this.rosterButtons.forEach((btn, i) => {
      const isSelected = i === index;
      btn.classList.toggle('is-selected', isSelected);
      btn.setAttribute('aria-current', isSelected ? 'true' : 'false');
    });
    const character = this.characters[index];
    if (character) this.renderPreview(character, true);
  }

  private choose(index: number): void {
    const character = this.characters[index];
    if (!character) return;
    this.select(index);
    this.onChosen(character);
  }

  private handleRosterKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = Math.min(this.selectedIndex + 1, this.characters.length - 1);
      this.select(next);
      this.rosterButtons[next]?.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = Math.max(this.selectedIndex - 1, 0);
      this.select(prev);
      this.rosterButtons[prev]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.choose(this.selectedIndex);
    }
  }

  private renderPreview(character: CharacterDef, animate: boolean): void {
    if (!animate || !this.previewRendered) {
      this.previewInner.replaceChildren(...this.buildPreviewContent(character));
      this.previewRendered = true;
      return;
    }
    this.previewInner.classList.add('cs-fade-out');
    window.setTimeout(() => {
      this.previewInner.replaceChildren(...this.buildPreviewContent(character));
      requestAnimationFrame(() => {
        this.previewInner.classList.remove('cs-fade-out');
      });
    }, PREVIEW_FADE_MS);
  }

  private buildPreviewContent(character: CharacterDef): HTMLElement[] {
    const stats = referenceStats(character);
    const diff = difficultyOf(character, stats);
    const weaponMeta = getWeaponMetadata(character.startWeaponId);
    const weaponName = weaponMeta ? t(weaponMeta.name) : fallbackWeaponName(character.startWeaponId);

    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'cs-preview-portrait-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'cs-preview-portrait';
    canvas.width = PREVIEW_PORTRAIT_SIZE;
    canvas.height = PREVIEW_PORTRAIT_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      drawCharacterPortrait(ctx, PREVIEW_PORTRAIT_SIZE, character.spriteKey);
    }
    portraitWrap.append(canvas);

    const header = document.createElement('div');
    header.className = 'cs-preview-header';
    const name = document.createElement('h3');
    name.className = 'cs-preview-name';
    name.textContent = character.name;

    const titleRow = document.createElement('div');
    titleRow.className = 'cs-preview-title-row';
    const title = document.createElement('span');
    title.className = 'cs-preview-title';
    title.textContent = t(character.title);
    const diffPill = document.createElement('span');
    diffPill.className = `cs-preview-diff cs-preview-diff--${diff}`;
    diffPill.textContent = t(DIFFICULTY_LABEL[diff]);
    titleRow.append(title, diffPill);

    header.append(name, titleRow);

    const weaponBlock = document.createElement('div');
    weaponBlock.className = 'cs-preview-weapon';
    const weaponIcon = document.createElement('img');
    weaponIcon.className = 'cs-preview-weapon-icon';
    weaponIcon.src = getUpgradeIconDataUrl(character.startWeaponId);
    weaponIcon.alt = '';
    const weaponText = document.createElement('div');
    weaponText.className = 'cs-preview-weapon-text';
    const weaponNameEl = document.createElement('div');
    weaponNameEl.className = 'cs-preview-weapon-name';
    weaponNameEl.textContent = weaponName;
    const weaponPattern = document.createElement('div');
    weaponPattern.className = 'cs-preview-weapon-pattern';
    weaponPattern.textContent = weaponMeta ? `${t('Patrón:')} ${t(weaponMeta.directionLabel)}` : '';
    weaponText.append(weaponNameEl, weaponPattern);
    weaponBlock.append(weaponIcon, weaponText);

    const trait = document.createElement('p');
    trait.className = 'cs-preview-trait';
    trait.textContent = t(character.traitDescription);

    const statsBlock = document.createElement('div');
    statsBlock.className = 'cs-preview-stats';
    for (const bar of buildStatBars(stats)) {
      statsBlock.append(this.buildStatRow(bar));
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'cs-confirm-btn';
    confirmBtn.textContent = `${t('Elegir a')} ${character.name}`;
    confirmBtn.addEventListener('click', () => this.onChosen(character));

    return [portraitWrap, header, weaponBlock, trait, statsBlock, confirmBtn];
  }

  private buildStatRow(bar: StatBarDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cs-stat-row';

    const label = document.createElement('span');
    label.className = 'cs-stat-label';
    label.textContent = bar.label;

    const track = document.createElement('div');
    track.className = 'cs-stat-track';
    const fill = document.createElement('div');
    fill.className = 'cs-stat-fill';
    fill.style.width = '0%';
    track.append(fill);

    const value = document.createElement('span');
    value.className = 'cs-stat-value';
    value.textContent = bar.display;

    row.append(label, track, value);

    // Start at 0% and bump to the real value one frame later so the CSS
    // width transition actually has something to animate from - a brand
    // new element can't transition from a value it never rendered at.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.width = `${bar.pct}%`;
      });
    });

    return row;
  }
}
