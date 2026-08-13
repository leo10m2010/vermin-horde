import type { StageDef } from '../game/Stages';
import { STAGE_PROPS, PROP_SOLID, PROP_BREAKABLE } from '../world/WorldProps';
import { spriteAtlas } from '../render/SpriteAtlas';
import { t } from '../i18n';

/**
 * Stage-select overlay, mounted into `#ui-root` alongside (but independent
 * of) `UiRoot`'s managed overlays. Fully self-contained: injects its own
 * scoped `<style>` tag once (never touches `src/styles.css`) so it stays
 * decoupled from whatever the main gothic redesign does there, and toggles
 * visibility via the `hidden` attribute like every other overlay in this
 * project (never just opacity), so an idle overlay never eats a click.
 */
const DIFFICULTY_LABEL: Record<StageDef['difficulty'], string> = {
  easy: 'Fácil',
  medium: 'Media',
  hard: 'Difícil',
};

export class StageSelect {
  private static styleInjected = false;

  private readonly overlayEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly confirmEl: HTMLButtonElement;
  private selected: StageDef | null = null;

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

    this.confirmEl = document.createElement('button');
    this.confirmEl.type = 'button';
    this.confirmEl.className = 'stagesel-confirm';
    this.confirmEl.disabled = true;
    this.confirmEl.textContent = t('Elige un escenario');
    this.confirmEl.addEventListener('click', () => {
      if (this.selected) this.onChosen(this.selected);
    });

    for (const side of ['tl', 'tr', 'bl', 'br']) {
      const corner = document.createElement('span');
      corner.className = `stagesel-corner stagesel-corner--${side}`;
      panel.append(corner);
    }

    panel.append(backBtn, heading, subtitle, this.gridEl, this.confirmEl);
    this.overlayEl.append(panel);
    this.root.append(this.overlayEl);
  }

  show(stages: StageDef[]): void {
    this.gridEl.replaceChildren(...stages.map((stage) => this.buildCard(stage)));
    this.overlayEl.hidden = false;
    // Pre-select the first stage so the screen is never in a dead state, but
    // still require the confirm press.
    if (stages.length > 0) this.select(stages[0]);
  }

  hide(): void {
    this.overlayEl.hidden = true;
    this.gridEl.replaceChildren();
    this.selected = null;
    this.confirmEl.disabled = true;
  }

  private buildCard(stage: StageDef): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'stagesel-card';
    card.dataset.stageId = stage.id;

    const preview = document.createElement('canvas');
    preview.className = 'stagesel-preview';
    preview.width = 240;
    preview.height = 132;
    drawStagePreview(preview, stage);

    const titleRow = document.createElement('div');
    titleRow.className = 'stagesel-title-row';
    const name = document.createElement('div');
    name.className = 'stagesel-name';
    name.textContent = t(stage.name);
    const diff = document.createElement('span');
    diff.className = `stagesel-diff stagesel-diff--${stage.difficulty}`;
    diff.textContent = t(DIFFICULTY_LABEL[stage.difficulty]);
    titleRow.append(name, diff);

    const desc = document.createElement('div');
    desc.className = 'stagesel-desc';
    desc.textContent = t(stage.description);

    const feature = document.createElement('div');
    feature.className = 'stagesel-feature';
    const featureLabel = document.createElement('span');
    featureLabel.className = 'stagesel-feature-label';
    featureLabel.textContent = t('TERRENO');
    const featureText = document.createElement('span');
    featureText.textContent = t(stage.feature);
    feature.append(featureLabel, featureText);

    card.append(preview, titleRow, desc, feature);
    // Select first, confirm second - same contract as Character Select, so a
    // misclick never drops the player straight into a run they did not want.
    card.addEventListener('click', () => this.select(stage));
    return card;
  }

  /** Highlights a stage and arms the confirm button. */
  private select(stage: StageDef): void {
    this.selected = stage;
    for (const el of this.gridEl.querySelectorAll('.stagesel-card')) {
      el.classList.toggle('is-selected', (el as HTMLElement).dataset.stageId === stage.id);
    }
    this.confirmEl.disabled = false;
    this.confirmEl.textContent = `${t('Descender a')} ${t(stage.name)}`;
  }

  private static injectStyle(): void {
    if (StageSelect.styleInjected) return;
    StageSelect.styleInjected = true;
    const style = document.createElement('style');
    style.textContent = STAGE_SELECT_CSS;
    document.head.append(style);
  }
}

/**
 * Stage preview diorama.
 *
 * The brief for this screen was explicit: no generic swatches. So the preview
 * is not a colour sample - it is a small scene built from the SAME assets the
 * stage actually uses: its ground palette, its real prop sprites blitted out
 * of the shared atlas, and a couple of enemies for scale. If a stage's prop
 * catalogue changes, its card changes with it, and the card cannot advertise
 * something the stage does not contain.
 */
function drawStagePreview(canvas: HTMLCanvasElement, stage: StageDef): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const w = canvas.width;
  const h = canvas.height;
  const rng = mulberry32(hashString(stage.id));

  // --- ground ---------------------------------------------------------
  ctx.fillStyle = stage.groundBaseColor;
  ctx.fillRect(0, 0, w, h);
  const cell = 6;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      if (rng() > 0.62) {
        ctx.fillStyle = rng() > 0.5 ? stage.groundFleckColorA : stage.groundFleckColorB;
        ctx.fillRect(x + Math.floor(rng() * 3), y + Math.floor(rng() * 3), 3, 3);
      }
    }
  }

  // --- real props, back to front --------------------------------------
  const props = STAGE_PROPS[stage.propSet] ?? [];
  const blit = (clip: string, cx: number, baseline: number, height: number): void => {
    if (!spriteAtlas.hasClip(clip)) return;
    const rect = spriteAtlas.getCellRect(spriteAtlas.getClip(clip).cells[0]);
    const drawH = Math.round(height);
    const drawW = drawH; // atlas cells are square; the art carries its own aspect
    ctx.drawImage(
      spriteAtlas.canvas,
      rect.x,
      rect.y,
      rect.size,
      rect.size,
      Math.round(cx - drawW / 2),
      Math.round(baseline - drawH),
      drawW,
      drawH,
    );
  };

  const solids = props.filter((p) => p.category === PROP_SOLID);
  const breakables = props.filter((p) => p.category === PROP_BREAKABLE);

  // Back row: the big silhouettes, smaller and dimmer for depth.
  ctx.globalAlpha = 0.72;
  solids.forEach((def, i) => {
    const cx = (w / (solids.length + 1)) * (i + 1) + (rng() - 0.5) * 10;
    blit(def.clip, cx, h * 0.66, h * 0.42);
  });
  ctx.globalAlpha = 1;

  // Front row: a breakable and a couple of enemies, at full size, so the
  // card shows what the player will actually be interacting with.
  breakables.forEach((def, i) => {
    const cx = w * (i === 0 ? 0.22 : 0.8);
    blit(def.clip, cx, h * 0.93, h * 0.3);
  });
  blit('enemy_grunt_idle', w * 0.46, h * 0.95, h * 0.3);
  blit('enemy_skeleton_idle', w * 0.6, h * 0.88, h * 0.26);

  // --- atmosphere ------------------------------------------------------
  if (stage.fogTint) {
    const fog = ctx.createLinearGradient(0, 0, 0, h);
    fog.addColorStop(0, `${stage.fogTint}dd`);
    fog.addColorStop(0.55, `${stage.fogTint}44`);
    fog.addColorStop(1, `${stage.fogTint}bb`);
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, w, h);
  }
  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.62);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
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
.stagesel-panel {
  position: relative;
  border-radius: 4px;
}

/* Same corner diamonds as Character Select and the pause/results panels, so
   every full-screen panel in the game is recognisably the same frame. */
.stagesel-corner {
  position: absolute;
  width: 13px;
  height: 13px;
  background: linear-gradient(135deg, #e8c468, #b8121f);
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.7);
  transform: rotate(45deg);
}
.stagesel-corner--tl { top: -7px; left: -7px; }
.stagesel-corner--tr { top: -7px; right: -7px; }
.stagesel-corner--bl { bottom: -7px; left: -7px; }
.stagesel-corner--br { bottom: -7px; right: -7px; }

.stagesel-heading {
  color: #e8c468;
  text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.8), 0 0 16px rgba(184, 18, 31, 0.35);
}

.stagesel-preview {
  width: 100%;
  height: auto;
  aspect-ratio: 240 / 132;
  image-rendering: pixelated;
  border: 1px solid rgba(201, 162, 39, 0.35);
  border-radius: 2px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.65);
}

.stagesel-card {
  align-items: stretch;
  text-align: left;
  gap: 7px;
}

.stagesel-card.is-selected {
  border-color: #e8c468;
  background: linear-gradient(180deg, rgba(138, 3, 3, 0.34), rgba(10, 5, 4, 0.92));
  box-shadow: 0 0 0 1px rgba(232, 196, 104, 0.35), 0 0 22px rgba(184, 18, 31, 0.4);
}

.stagesel-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stagesel-name {
  text-align: left;
}

.stagesel-diff {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.stagesel-diff--easy { color: #8fc46a; }
.stagesel-diff--medium { color: #e8c468; }
.stagesel-diff--hard { color: #e0603f; }

.stagesel-desc {
  text-align: left;
}

.stagesel-feature {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: auto;
  padding-top: 7px;
  border-top: 1px solid rgba(201, 162, 39, 0.2);
  font-size: 0.73rem;
  line-height: 1.35;
  color: rgba(232, 221, 199, 0.8);
}

.stagesel-feature-label {
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  color: rgba(201, 162, 39, 0.75);
}

.stagesel-confirm {
  appearance: none;
  margin-top: 6px;
  padding: 11px 34px;
  background: linear-gradient(180deg, #b8121f, #6d0a12);
  border: 1px solid #e8c468;
  border-radius: 3px;
  color: #f4e7c8;
  font-family: 'Segoe UI', Avenir, sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
}

.stagesel-confirm:hover:not(:disabled),
.stagesel-confirm:focus-visible:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 20px rgba(184, 18, 31, 0.55);
}

.stagesel-confirm:disabled {
  filter: grayscale(0.7) brightness(0.6);
  cursor: default;
}

/* Shared entrance language, same numbers as styles.css and Character Select,
   so moving Main Menu -> Character Select -> Stage Select -> run never hard
   cuts and never changes its mind about how a screen arrives. */
.stagesel-overlay {
  animation: stagesel-screen-in 0.2s ease-out both;
}
.stagesel-panel {
  animation: stagesel-panel-in 0.26s cubic-bezier(0.2, 0.8, 0.3, 1) both;
}
@keyframes stagesel-screen-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes stagesel-panel-in {
  from { opacity: 0; transform: translateY(12px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Cards arrive left-to-right rather than all at once, matching the level-up
   row and the main-menu buttons. */
.stagesel-card {
  animation: stagesel-card-in 0.26s cubic-bezier(0.2, 0.8, 0.3, 1) both;
}
.stagesel-card:nth-child(2) { animation-delay: 60ms; }
.stagesel-card:nth-child(3) { animation-delay: 120ms; }

@keyframes stagesel-card-in {
  from { opacity: 0; transform: translateY(10px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .stagesel-overlay,
  .stagesel-panel,
  .stagesel-card {
    animation: none;
  }
  .stagesel-card,
  .stagesel-back,
  .stagesel-confirm {
    transition: none;
  }
}
`;
