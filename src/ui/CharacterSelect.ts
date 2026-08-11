import type { CharacterDef } from '../game/Characters';
import { drawCharacterPortrait } from '../render/SpriteLibraryCharacters';

const STYLE_ID = 'character-select-styles';
const PORTRAIT_SIZE = 96;

// Local display-name lookup for every weapon id a character might start
// with, including the ~4-5 new ids landing in parallel with the weapons
// pass. Deliberately hardcoded (not imported from WeaponRegistry) to avoid
// any coupling with that module while it's actively changing.
const WEAPON_DISPLAY_NAMES: Record<string, string> = {
  magic_wand: 'Magic Wand',
  axe_throw: 'Axe',
  knife_throw: 'Knife',
  fireball: 'Fireball',
  garlic_aura: 'Garlic Aura',
  orbiter_blades: 'Holy Blades',
  whip_strike: 'Whip Strike',
  arc_cross: 'Arc Cross',
  ember_wand: 'Ember Wand',
  rune_shard: 'Rune Shard',
  hex_flask: 'Hex Flask',
};

function weaponDisplayName(id: string): string {
  return WEAPON_DISPLAY_NAMES[id] ?? id;
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
      background: rgba(12, 15, 10, 0.72);
      pointer-events: auto;
      z-index: 20;
      color: #f2f0e6;
      font-family: 'Segoe UI', Avenir, sans-serif;
    }
    #character-select-overlay[hidden] {
      display: none !important;
      pointer-events: none;
    }
    .cs-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      width: 100%;
      max-width: 860px;
      padding: 28px 32px;
      background: rgba(12, 15, 10, 0.92);
      border: 1px solid rgba(242, 240, 230, 0.28);
      border-radius: 10px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .cs-heading {
      margin: 0;
      font-size: 1.3rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      background: linear-gradient(90deg, #59e0ff, #b06dff);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .cs-subtitle {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 500;
      opacity: 0.78;
    }
    .cs-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      width: 100%;
    }
    @media (max-width: 680px) {
      .cs-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 420px) {
      .cs-grid {
        grid-template-columns: 1fr;
      }
    }
    .cs-card {
      appearance: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 14px;
      background: rgba(242, 240, 230, 0.06);
      border: 1px solid rgba(242, 240, 230, 0.22);
      border-radius: 8px;
      color: #f2f0e6;
      text-align: center;
      cursor: pointer;
      transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      font-family: inherit;
    }
    .cs-card:hover,
    .cs-card:focus-visible {
      border-color: #59e0ff;
      background: rgba(89, 224, 255, 0.1);
      transform: translateY(-3px);
    }
    .cs-portrait {
      width: 72px;
      height: 72px;
      image-rendering: pixelated;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
    }
    .cs-name {
      font-size: 0.95rem;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .cs-title {
      margin-top: -6px;
      font-size: 0.72rem;
      font-style: italic;
      opacity: 0.75;
    }
    .cs-weapon {
      align-self: center;
      padding: 2px 8px;
      background: rgba(176, 109, 255, 0.22);
      border-radius: 10px;
      color: #d3b3ff;
      font-size: 0.62rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .cs-trait {
      font-size: 0.74rem;
      font-weight: 500;
      line-height: 1.35;
      opacity: 0.85;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Self-contained character-select overlay. Mounts its own child element
 * directly into the shared #ui-root container (does not touch UiRoot.ts)
 * and injects its own <style> tag, so it never collides with the sibling
 * menu redesign happening on styles.css/UiRoot.ts this round.
 */
export class CharacterSelect {
  private readonly overlay: HTMLElement;
  private readonly gridEl: HTMLElement;

  constructor(root: HTMLElement, private readonly onChosen: (character: CharacterDef) => void) {
    injectStyles();

    this.overlay = document.createElement('div');
    this.overlay.id = 'character-select-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'cs-panel';

    const heading = document.createElement('h2');
    heading.className = 'cs-heading';
    heading.textContent = 'Elige tu personaje';

    const subtitle = document.createElement('p');
    subtitle.className = 'cs-subtitle';
    subtitle.textContent = 'Cada personaje inicia con un arma distinta y un rasgo único para toda la partida.';

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'cs-grid';

    panel.append(heading, subtitle, this.gridEl);
    this.overlay.append(panel);
    root.append(this.overlay);
  }

  show(characters: CharacterDef[]): void {
    this.gridEl.replaceChildren(...characters.map((c) => this.buildCard(c)));
    this.overlay.hidden = false;
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  private buildCard(character: CharacterDef): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cs-card';

    const canvas = document.createElement('canvas');
    canvas.className = 'cs-portrait';
    canvas.width = PORTRAIT_SIZE;
    canvas.height = PORTRAIT_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      drawCharacterPortrait(ctx, PORTRAIT_SIZE, character.spriteKey);
    }

    const name = document.createElement('div');
    name.className = 'cs-name';
    name.textContent = character.name;

    const title = document.createElement('div');
    title.className = 'cs-title';
    title.textContent = character.title;

    const weapon = document.createElement('div');
    weapon.className = 'cs-weapon';
    weapon.textContent = weaponDisplayName(character.startWeaponId);

    const trait = document.createElement('div');
    trait.className = 'cs-trait';
    trait.textContent = character.traitDescription;

    card.append(canvas, name, title, weapon, trait);
    card.addEventListener('click', () => this.onChosen(character));
    return card;
  }
}
