import type { ArcanaDef } from '../systems/ArcanaSystem';

const STYLE_ID = 'arcana-picker-styles';
const ICON_SIZE = 40;

// Procedurally-drawn pixel icons for arcana cards, self-contained (same
// canvas-primitives-only approach as src/ui/Icons.ts) since these ids are
// unique to ArcanaSystem.
type IconDraw = (ctx: CanvasRenderingContext2D) => void;

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

const ICON_DRAWERS: Record<string, IconDraw> = {
  blood_pact: (ctx) => {
    px(ctx, 16, 6, 5, 14, '#d9403a');
    px(ctx, 10, 12, 14, 5, '#d9403a');
    px(ctx, 8, 22, 24, 5, '#8a1a1a');
    px(ctx, 12, 27, 16, 4, '#8a1a1a');
  },
  undying_momentum: (ctx) => {
    px(ctx, 4, 18, 14, 4, '#59e0ff');
    px(ctx, 12, 24, 14, 4, '#59e0ff');
    px(ctx, 8, 12, 14, 4, 'rgba(89,224,255,0.55)');
    px(ctx, 20, 15, 6, 4, '#fff6d8');
  },
  second_chance: (ctx) => {
    ring(ctx, 20, 20, 14, 3, '#b06dff');
    px(ctx, 17, 8, 6, 12, '#f2f0e6');
    px(ctx, 17, 20, 6, 12, '#f2f0e6');
  },
  fortunes_eye: (ctx) => {
    circle(ctx, 12, 14, 5, '#59c97a');
    circle(ctx, 28, 14, 5, '#59c97a');
    circle(ctx, 12, 27, 5, '#59c97a');
    circle(ctx, 28, 27, 5, '#59c97a');
    px(ctx, 18, 18, 4, 6, '#3a8a52');
  },
  overgrowth: (ctx) => {
    ring(ctx, 20, 20, 15, 3, 'rgba(89,224,255,0.4)');
    ring(ctx, 20, 20, 9, 3, 'rgba(89,224,255,0.7)');
    circle(ctx, 20, 20, 4, '#59e0ff');
  },
  titans_blood: (ctx) => {
    px(ctx, 9, 6, 10, 10, '#ff5a7a');
    px(ctx, 21, 6, 10, 10, '#ff5a7a');
    px(ctx, 7, 14, 26, 8, '#ff5a7a');
    px(ctx, 12, 24, 16, 7, '#ff5a7a');
    px(ctx, 16, 31, 8, 4, '#ff5a7a');
  },
  frenzied_assault: (ctx) => {
    px(ctx, 4, 18, 32, 4, '#ffd35c');
    px(ctx, 20, 8, 12, 4, 'rgba(255,211,92,0.7)');
    px(ctx, 20, 28, 12, 4, 'rgba(255,211,92,0.7)');
    px(ctx, 28, 12, 7, 4, '#fff6d8');
    px(ctx, 28, 24, 7, 4, '#fff6d8');
  },
  golden_harvest: (ctx) => {
    circle(ctx, 20, 22, 13, '#ffd35c');
    circle(ctx, 20, 22, 9, '#c98a3a');
    px(ctx, 12, 8, 16, 8, '#c98a3a');
  },
};

const iconCache = new Map<string, string>();

function getArcanaIconDataUrl(id: string): string {
  const cached = iconCache.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const draw = ICON_DRAWERS[id] ?? ICON_DRAWERS.overgrowth;
  draw(ctx);
  const url = canvas.toDataURL();
  iconCache.set(id, url);
  return url;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #arcana-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      padding: 24px;
      background: radial-gradient(circle at 50% 40%, rgba(60, 20, 90, 0.55), rgba(12, 15, 10, 0.88));
      pointer-events: auto;
      z-index: 5;
    }
    #arcana-overlay[hidden] { display: none !important; pointer-events: none; }
    .arcana-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      width: 100%;
      max-width: 920px;
    }
    .arcana-heading {
      margin: 0;
      font-size: clamp(1.3rem, 4vw, 1.9rem);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      text-align: center;
      background: linear-gradient(90deg, #ffd35c, #b06dff);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .arcana-sub {
      margin: -10px 0 0;
      font-size: 0.8rem;
      opacity: 0.75;
      text-align: center;
    }
    .arcana-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
      width: 100%;
    }
    .arcana-card {
      appearance: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 22px;
      background: linear-gradient(160deg, rgba(176, 109, 255, 0.14), rgba(255, 211, 92, 0.08));
      border: 1.5px solid rgba(255, 211, 92, 0.5);
      border-radius: 12px;
      color: #f2f0e6;
      text-align: left;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
      transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
    }
    .arcana-card:hover,
    .arcana-card:focus-visible {
      border-color: #ffd35c;
      transform: translateY(-4px) scale(1.01);
      box-shadow: 0 18px 40px rgba(255, 211, 92, 0.25);
    }
    .arcana-card-head {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .arcana-card-icon {
      width: 40px;
      height: 40px;
      flex: 0 0 auto;
      image-rendering: pixelated;
      filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.6));
    }
    .arcana-card-name {
      font-size: 1.1rem;
      font-weight: 800;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: #ffd35c;
    }
    .arcana-card-desc {
      font-size: 0.85rem;
      line-height: 1.45;
      opacity: 0.9;
    }
  `;
  document.head.append(style);
}

/**
 * Dramatic, rarer-feeling overlay for ArcanaSystem offers - visually bigger
 * and more special (gold/purple accents) than the regular UpgradeSystem
 * level-up picker. Self-contained: own injected <style>, mounts into the
 * host element it's given.
 */
export class ArcanaPicker {
  private readonly overlayEl: HTMLElement;
  private readonly gridEl: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChosen: (arcana: ArcanaDef) => void,
  ) {
    injectStyles();

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'arcana-overlay';
    this.overlayEl.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'arcana-panel';

    const heading = document.createElement('h2');
    heading.className = 'arcana-heading';
    heading.textContent = 'Arcano Despertado';

    const sub = document.createElement('p');
    sub.className = 'arcana-sub';
    sub.textContent = 'Un poder raro se manifiesta. Elige uno.';

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'arcana-grid';

    panel.append(heading, sub, this.gridEl);
    this.overlayEl.append(panel);
    this.root.append(this.overlayEl);
  }

  show(options: ArcanaDef[]): void {
    this.gridEl.replaceChildren(...options.map((arcana) => this.buildCard(arcana)));
    this.overlayEl.hidden = false;
  }

  hide(): void {
    this.overlayEl.hidden = true;
    this.gridEl.replaceChildren();
  }

  private buildCard(arcana: ArcanaDef): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'arcana-card';

    const head = document.createElement('div');
    head.className = 'arcana-card-head';
    const icon = document.createElement('img');
    icon.className = 'arcana-card-icon';
    icon.src = getArcanaIconDataUrl(arcana.id);
    icon.alt = '';
    const name = document.createElement('div');
    name.className = 'arcana-card-name';
    name.textContent = arcana.name;
    head.append(icon, name);

    const desc = document.createElement('div');
    desc.className = 'arcana-card-desc';
    desc.textContent = arcana.description;

    card.append(head, desc);
    card.addEventListener('click', () => {
      this.onChosen(arcana);
      this.hide();
    });
    return card;
  }
}
