import type { MetaProgression, PermanentUpgradeDef } from '../game/MetaProgression';
import { t } from '../i18n';

const STYLE_ID = 'shop-styles';
const ICON_SIZE = 30;

// Small procedurally-drawn pixel icons for the shop, in the same spirit as
// src/ui/Icons.ts (canvas primitives only, no emoji) but self-contained here
// since Shop.ts owns its own presentation and Icons.ts belongs to a sibling
// system's upgrade ids.
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
  ancestral_vigor: (ctx) => {
    px(ctx, 6, 9, 8, 8, '#ff5a7a');
    px(ctx, 16, 9, 8, 8, '#ff5a7a');
    px(ctx, 5, 13, 20, 7, '#ff5a7a');
    px(ctx, 9, 19, 12, 6, '#ff5a7a');
    px(ctx, 12, 24, 6, 3, '#ff5a7a');
  },
  grave_boots: (ctx) => {
    px(ctx, 6, 8, 10, 4, '#59e0ff');
    px(ctx, 9, 14, 12, 4, '#59e0ff');
    px(ctx, 6, 20, 10, 4, '#59e0ff');
  },
  bone_charm: (ctx) => {
    circle(ctx, 9, 10, 4, '#f2f0e6');
    circle(ctx, 19, 10, 4, '#f2f0e6');
    circle(ctx, 9, 19, 4, '#f2f0e6');
    circle(ctx, 19, 19, 4, '#f2f0e6');
    px(ctx, 13, 13, 2, 8, '#c7cdd6');
  },
  wardstone: (ctx) => {
    px(ctx, 7, 4, 14, 5, '#8fb4ff');
    px(ctx, 6, 9, 16, 9, '#6a95e0');
    px(ctx, 8, 18, 12, 5, '#6a95e0');
    px(ctx, 11, 23, 6, 3, '#4a70c0');
  },
  ember_heart: (ctx) => {
    circle(ctx, 14, 17, 8, '#c9401f');
    circle(ctx, 14, 15, 6, '#ff8a3d');
    circle(ctx, 14, 13, 3.5, '#ffd35c');
  },
  fleet_step: (ctx) => {
    px(ctx, 3, 13, 16, 3, '#ffd35c');
    px(ctx, 14, 8, 8, 3, 'rgba(255,211,92,0.6)');
    px(ctx, 14, 17, 8, 3, 'rgba(255,211,92,0.6)');
    px(ctx, 19, 10, 5, 3, '#fff6d8');
  },
  hunters_eye: (ctx) => {
    px(ctx, 12, 2, 4, 24, '#ffd35c');
    px(ctx, 2, 12, 24, 4, '#ffd35c');
    circle(ctx, 14, 14, 4, '#fff6d8');
  },
  spirit_regen: (ctx) => {
    circle(ctx, 14, 14, 11, '#59c97a');
    px(ctx, 12, 8, 4, 12, '#f2f0e6');
    px(ctx, 8, 12, 12, 4, '#f2f0e6');
  },
  old_coin_purse: (ctx) => {
    circle(ctx, 14, 16, 9, '#ffd35c');
    circle(ctx, 14, 16, 6, '#c98a3a');
    px(ctx, 8, 6, 10, 6, '#c98a3a');
  },
  second_wind: (ctx) => {
    ring(ctx, 14, 14, 10, 2.5, '#b06dff');
    px(ctx, 12, 5, 4, 8, '#f2f0e6');
    px(ctx, 12, 16, 4, 8, '#f2f0e6');
  },
};

const iconCache = new Map<string, string>();

function getShopIconDataUrl(id: string): string {
  const cached = iconCache.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const draw = ICON_DRAWERS[id] ?? ICON_DRAWERS.wardstone;
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
    #shop-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      padding: 24px;
      background: rgba(12, 15, 10, 0.82);
      pointer-events: auto;
    }
    #shop-overlay[hidden] { display: none !important; pointer-events: none; }
    .shop-panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 820px;
      padding: 28px 32px;
      background: rgba(12, 15, 10, 0.94);
      border: 1px solid rgba(242, 240, 230, 0.28);
      border-radius: 10px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
      color: #f2f0e6;
    }
    .shop-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .shop-title {
      margin: 0;
      font-size: 1.4rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .shop-gold {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: rgba(255, 211, 92, 0.14);
      border: 1px solid rgba(255, 211, 92, 0.4);
      border-radius: 20px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: #ffd35c;
      font-size: 1.05rem;
    }
    .shop-gold-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #fff6d8, #ffd35c 55%, #c98a3a 100%);
      box-shadow: 0 0 6px rgba(255, 211, 92, 0.6);
      flex: 0 0 auto;
    }
    .shop-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      max-height: 56vh;
      overflow-y: auto;
      padding-right: 4px;
    }
    @media (max-width: 640px) {
      .shop-grid { grid-template-columns: 1fr; }
    }
    .shop-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      background: rgba(242, 240, 230, 0.06);
      border: 1px solid rgba(242, 240, 230, 0.2);
      border-radius: 8px;
      text-align: left;
    }
    .shop-card--maxed {
      border-color: rgba(89, 224, 255, 0.5);
      background: rgba(89, 224, 255, 0.08);
    }
    .shop-card-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .shop-card-icon {
      width: 30px;
      height: 30px;
      flex: 0 0 auto;
      image-rendering: pixelated;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
    }
    .shop-card-name {
      font-weight: 800;
      font-size: 0.92rem;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .shop-card-level {
      margin-left: auto;
      font-size: 0.72rem;
      font-weight: 700;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .shop-card-desc {
      font-size: 0.78rem;
      line-height: 1.35;
      opacity: 0.82;
    }
    .shop-buy-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: auto;
    }
    .shop-cost {
      font-size: 0.8rem;
      font-weight: 700;
      color: #ffd35c;
      font-variant-numeric: tabular-nums;
    }
    .shop-buy-btn {
      appearance: none;
      padding: 8px 16px;
      border: 1px solid rgba(242, 240, 230, 0.32);
      border-radius: 6px;
      background: rgba(242, 240, 230, 0.08);
      color: #f2f0e6;
      font-weight: 700;
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease, filter 0.12s ease;
    }
    .shop-buy-btn:hover:not(:disabled) {
      background: rgba(255, 211, 92, 0.24);
      border-color: #ffd35c;
      transform: translateY(-1px);
    }
    .shop-buy-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      filter: grayscale(0.6);
    }
    .shop-close-btn {
      align-self: center;
      appearance: none;
      padding: 12px 28px;
      border: 1px solid rgba(242, 240, 230, 0.32);
      border-radius: 6px;
      background: rgba(242, 240, 230, 0.08);
      color: #f2f0e6;
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
      transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease;
    }
    .shop-close-btn:hover {
      background: rgba(242, 240, 230, 0.18);
      border-color: rgba(242, 240, 230, 0.5);
      transform: translateY(-1px);
    }
  `;
  document.head.append(style);
}

export interface ShopCallbacks {
  onClose: () => void;
}

/**
 * Self-contained between-runs shop overlay: spend persistent gold on
 * permanent MetaProgression upgrades. Mounts into the same #ui-root host as
 * UiRoot's overlays but manages its own DOM/style, so it never touches
 * UiRoot.ts or styles.css.
 */
export class Shop {
  private readonly overlayEl: HTMLElement;
  private readonly goldValueEl: HTMLElement;
  private readonly gridEl: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly meta: MetaProgression,
    private readonly callbacks: ShopCallbacks,
  ) {
    injectStyles();

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'shop-overlay';
    this.overlayEl.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'shop-panel';

    const header = document.createElement('div');
    header.className = 'shop-header';
    const title = document.createElement('h2');
    title.className = 'shop-title';
    title.textContent = t('Mercader Errante');
    const goldBadge = document.createElement('div');
    goldBadge.className = 'shop-gold';
    const goldIcon = document.createElement('span');
    goldIcon.className = 'shop-gold-icon';
    this.goldValueEl = document.createElement('span');
    goldBadge.append(goldIcon, this.goldValueEl);
    header.append(title, goldBadge);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'shop-grid';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'shop-close-btn';
    closeBtn.textContent = t('Cerrar');
    closeBtn.addEventListener('click', () => {
      this.hide();
      this.callbacks.onClose();
    });

    panel.append(header, this.gridEl, closeBtn);
    this.overlayEl.append(panel);
    this.root.append(this.overlayEl);
  }

  show(): void {
    this.refresh();
    this.overlayEl.hidden = false;
  }

  hide(): void {
    this.overlayEl.hidden = true;
  }

  /** Re-render gold total + upgrade levels/costs. Call after any purchase. */
  refresh(): void {
    this.goldValueEl.textContent = String(this.meta.gold);
    this.gridEl.replaceChildren(...this.meta.upgrades.map((def) => this.buildCard(def)));
  }

  private buildCard(def: PermanentUpgradeDef): HTMLElement {
    const level = this.meta.getUpgradeLevel(def.id);
    const maxed = level >= def.maxLevel;

    const card = document.createElement('div');
    card.className = maxed ? 'shop-card shop-card--maxed' : 'shop-card';
    // Lets a test click a specific upgrade's real Buy button without matching
    // on translated display names.
    card.dataset.upgradeId = def.id;

    const head = document.createElement('div');
    head.className = 'shop-card-head';
    const icon = document.createElement('img');
    icon.className = 'shop-card-icon';
    icon.src = getShopIconDataUrl(def.id);
    icon.alt = '';
    const name = document.createElement('div');
    name.className = 'shop-card-name';
    name.textContent = t(def.name);
    const levelEl = document.createElement('div');
    levelEl.className = 'shop-card-level';
    levelEl.textContent = `${t('Nv.')} ${level}/${def.maxLevel}`;
    head.append(icon, name, levelEl);

    const desc = document.createElement('div');
    desc.className = 'shop-card-desc';
    desc.textContent = t(def.description);

    const buyRow = document.createElement('div');
    buyRow.className = 'shop-buy-row';
    const cost = maxed ? 0 : def.costPerLevel(level);
    const costEl = document.createElement('div');
    costEl.className = 'shop-cost';
    costEl.textContent = maxed ? t('MAX') : `${cost} ${t('oro')}`;

    const buyBtn = document.createElement('button');
    buyBtn.type = 'button';
    buyBtn.className = 'shop-buy-btn';
    buyBtn.textContent = maxed ? t('Máximo') : t('Comprar');
    const affordable = !maxed && this.meta.gold >= cost;
    buyBtn.disabled = maxed || !affordable;
    buyBtn.addEventListener('click', () => {
      if (this.meta.buyUpgrade(def.id)) this.refresh();
    });

    buyRow.append(costEl, buyBtn);
    card.append(head, desc, buyRow);
    return card;
  }
}
