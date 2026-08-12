import type { StageDef } from '../game/Stages';
import { t } from '../i18n';

/**
 * Stage-select overlay, mounted into `#ui-root` alongside (but independent
 * of) `UiRoot`'s managed overlays. Fully self-contained: injects its own
 * scoped `<style>` tag once (never touches `src/styles.css`) so it stays
 * decoupled from whatever the main gothic redesign does there, and toggles
 * visibility via the `hidden` attribute like every other overlay in this
 * project (never just opacity), so an idle overlay never eats a click.
 */
export class StageSelect {
  private static styleInjected = false;

  private readonly overlayEl: HTMLElement;
  private readonly gridEl: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChosen: (stage: StageDef) => void,
    private readonly onBack?: () => void,
  ) {
    StageSelect.injectStyle();

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'stagesel-overlay';
    this.overlayEl.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'stagesel-panel';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'stagesel-back';
    backBtn.textContent = t('← Volver');
    backBtn.addEventListener('click', () => this.onBack?.());

    const heading = document.createElement('h2');
    heading.className = 'stagesel-heading';
    heading.textContent = t('Elige un escenario');

    const subtitle = document.createElement('p');
    subtitle.className = 'stagesel-subtitle';
    subtitle.textContent = t('Cada lugar esconde su propio terror.');

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'stagesel-grid';

    panel.append(backBtn, heading, subtitle, this.gridEl);
    this.overlayEl.append(panel);
    this.root.append(this.overlayEl);
  }

  show(stages: StageDef[]): void {
    this.gridEl.replaceChildren(...stages.map((stage) => this.buildCard(stage)));
    this.overlayEl.hidden = false;
  }

  hide(): void {
    this.overlayEl.hidden = true;
    this.gridEl.replaceChildren();
  }

  private buildCard(stage: StageDef): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'stagesel-card';

    const swatch = document.createElement('canvas');
    swatch.className = 'stagesel-swatch';
    swatch.width = 96;
    swatch.height = 96;
    drawStageSwatch(swatch, stage);

    const name = document.createElement('div');
    name.className = 'stagesel-name';
    name.textContent = t(stage.name);

    const desc = document.createElement('div');
    desc.className = 'stagesel-desc';
    desc.textContent = t(stage.description);

    card.append(swatch, name, desc);
    card.addEventListener('click', () => this.onChosen(stage));
    return card;
  }

  private static injectStyle(): void {
    if (StageSelect.styleInjected) return;
    StageSelect.styleInjected = true;
    const style = document.createElement('style');
    style.textContent = STAGE_SELECT_CSS;
    document.head.append(style);
  }
}

/** Small tiled-pattern preview using the stage's own palette, same spirit as the real ground texture generator (`createGroundMesh`) but simplified for a thumbnail-sized canvas. */
function drawStageSwatch(canvas: HTMLCanvasElement, stage: StageDef): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const size = canvas.width;

  ctx.fillStyle = stage.groundBaseColor;
  ctx.fillRect(0, 0, size, size);

  const rng = mulberry32(hashString(stage.id));
  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      if (rng() > 0.7) {
        ctx.fillStyle = rng() > 0.5 ? stage.groundFleckColorA : stage.groundFleckColorB;
        const fx = x + Math.floor(rng() * (cell - 3));
        const fy = y + Math.floor(rng() * (cell - 3));
        ctx.fillRect(fx, fy, 3, 3);
      }
    }
  }

  ctx.strokeStyle = 'rgba(232, 196, 104, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Scoped, self-contained gothic-horror styling for the stage select overlay.
// Deliberately hardcodes its own palette (rather than relying on variables
// from `src/styles.css`) so this file has zero coupling to that stylesheet.
const STAGE_SELECT_CSS = `
.stagesel-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 24px;
  background: radial-gradient(ellipse at center, rgba(22, 8, 7, 0.6) 0%, rgba(4, 2, 2, 0.93) 100%);
  pointer-events: auto;
  font-family: 'Segoe UI', Avenir, sans-serif;
}

.stagesel-overlay[hidden] {
  display: none !important;
  pointer-events: none;
}

.stagesel-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 760px;
  padding: 30px 34px;
  background: linear-gradient(180deg, #1c100d, #0c0605);
  border: 2px solid #8a0303;
  box-shadow:
    inset 0 0 0 1px rgba(201, 162, 39, 0.4),
    inset 0 0 40px rgba(0, 0, 0, 0.5),
    0 18px 60px rgba(0, 0, 0, 0.65);
  text-align: center;
}

.stagesel-back {
  appearance: none;
  align-self: flex-start;
  margin-bottom: -6px;
  padding: 6px 12px;
  background: rgba(232, 221, 199, 0.06);
  border: 1px solid rgba(232, 221, 199, 0.3);
  border-radius: 4px;
  color: #e8ddc7;
  font-family: Georgia, 'Times New Roman', 'Palatino Linotype', serif;
  font-size: 0.78rem;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}

.stagesel-back:hover,
.stagesel-back:focus-visible {
  border-color: #e8c468;
  background: rgba(232, 196, 104, 0.12);
}

.stagesel-heading {
  margin: 0;
  font-family: Georgia, 'Times New Roman', 'Palatino Linotype', serif;
  font-size: 1.5rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #e8ddc7;
  text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.8);
}

.stagesel-subtitle {
  margin: 0;
  font-family: Georgia, 'Times New Roman', 'Palatino Linotype', serif;
  font-style: italic;
  font-size: 0.85rem;
  color: rgba(232, 221, 199, 0.72);
}

.stagesel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
}

@media (max-width: 640px) {
  .stagesel-grid {
    grid-template-columns: 1fr;
  }
}

.stagesel-card {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(28, 16, 13, 0.75), rgba(10, 5, 4, 0.85));
  border: 1px solid rgba(201, 162, 39, 0.4);
  border-radius: 4px;
  color: #e8ddc7;
  text-align: center;
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

.stagesel-card:hover,
.stagesel-card:focus-visible {
  border-color: #e8c468;
  background: linear-gradient(180deg, rgba(138, 3, 3, 0.28), rgba(10, 5, 4, 0.9));
  box-shadow: 0 0 18px rgba(184, 18, 31, 0.35);
  transform: translateY(-3px);
}

.stagesel-swatch {
  width: 96px;
  height: 96px;
  image-rendering: pixelated;
  border-radius: 2px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.6);
}

.stagesel-name {
  font-family: Georgia, 'Times New Roman', 'Palatino Linotype', serif;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #e8ddc7;
}

.stagesel-desc {
  font-size: 0.76rem;
  font-weight: 500;
  line-height: 1.35;
  color: rgba(232, 221, 199, 0.72);
}
`;
