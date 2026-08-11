// Small procedurally-drawn pixel icons for upgrade cards (weapons + passives).
// Everything here is drawn with Canvas 2D primitives - no emoji, no external
// art - matching the rest of the game's fully-procedural asset pipeline.

const SIZE = 28;

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

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

type Draw = (ctx: CanvasRenderingContext2D) => void;

const DRAWERS: Record<string, Draw> = {
  magic_wand: (ctx) => {
    px(ctx, 8, 18, 5, 5, '#8a6a3a');
    px(ctx, 11, 15, 4, 4, '#c98a3a');
    px(ctx, 15, 9, 3, 3, '#ffd35c');
    px(ctx, 12, 6, 3, 3, '#fff6d8');
    px(ctx, 18, 6, 3, 3, '#fff6d8');
    px(ctx, 15, 3, 3, 3, '#fff6d8');
  },
  axe_throw: (ctx) => {
    px(ctx, 12, 6, 4, 18, '#8a6a3a');
    px(ctx, 16, 4, 8, 4, '#c7cdd6');
    px(ctx, 20, 8, 6, 4, '#c7cdd6');
    px(ctx, 16, 12, 8, 3, '#c7cdd6');
    px(ctx, 24, 6, 2, 8, '#7c8592');
  },
  knife_throw: (ctx) => {
    px(ctx, 13, 4, 3, 14, '#e7ecf2');
    px(ctx, 12, 16, 5, 3, '#8a6a3a');
    px(ctx, 13, 19, 3, 4, '#5c4526');
    circle(ctx, 14, 4, 2, '#fff6d8');
  },
  fireball: (ctx) => {
    circle(ctx, 14, 16, 8, '#c9401f');
    circle(ctx, 14, 14, 6, '#ff8a3d');
    circle(ctx, 14, 12, 3.5, '#ffd35c');
    px(ctx, 12, 3, 3, 6, '#ff8a3d');
    px(ctx, 16, 5, 2, 4, '#ffd35c');
  },
  garlic_aura: (ctx) => {
    ring(ctx, 14, 14, 10, 2, 'rgba(255,209,102,0.85)');
    ring(ctx, 14, 14, 6, 2, 'rgba(255,209,102,0.55)');
    circle(ctx, 14, 14, 2.5, '#ffe9b0');
  },
  orbiter_blades: (ctx) => {
    circle(ctx, 14, 14, 3, '#59e0ff');
    px(ctx, 3, 12, 5, 3, '#b06dff');
    px(ctx, 20, 12, 5, 3, '#b06dff');
    px(ctx, 12, 3, 3, 5, '#b06dff');
    px(ctx, 12, 20, 3, 5, '#b06dff');
    ring(ctx, 14, 14, 9, 1, 'rgba(176,109,255,0.35)');
  },
  passive_damage: (ctx) => {
    px(ctx, 12, 4, 4, 10, '#ff5a4d');
    px(ctx, 8, 10, 12, 4, '#ff5a4d');
    px(ctx, 6, 16, 16, 4, '#c9401f');
    px(ctx, 10, 20, 8, 4, '#c9401f');
  },
  passive_health: (ctx) => {
    px(ctx, 6, 8, 7, 7, '#ff5a7a');
    px(ctx, 15, 8, 7, 7, '#ff5a7a');
    px(ctx, 5, 12, 18, 6, '#ff5a7a');
    px(ctx, 9, 18, 10, 5, '#ff5a7a');
    px(ctx, 12, 22, 4, 3, '#ff5a7a');
  },
  passive_armor: (ctx) => {
    px(ctx, 7, 4, 14, 5, '#8fb4ff');
    px(ctx, 6, 9, 16, 9, '#6a95e0');
    px(ctx, 8, 18, 12, 5, '#6a95e0');
    px(ctx, 11, 23, 6, 3, '#4a70c0');
  },
  passive_speed: (ctx) => {
    px(ctx, 4, 8, 10, 4, '#59e0ff');
    px(ctx, 8, 14, 12, 4, '#59e0ff');
    px(ctx, 4, 20, 10, 4, '#59e0ff');
  },
  passive_area: (ctx) => {
    ring(ctx, 14, 14, 11, 2, 'rgba(89,224,255,0.35)');
    ring(ctx, 14, 14, 7, 2, 'rgba(89,224,255,0.6)');
    circle(ctx, 14, 14, 3, '#59e0ff');
  },
  passive_cooldown: (ctx) => {
    px(ctx, 8, 4, 12, 3, '#f2f0e6');
    px(ctx, 8, 21, 12, 3, '#f2f0e6');
    px(ctx, 10, 7, 8, 5, '#8fb4ff');
    px(ctx, 10, 16, 8, 5, '#8fb4ff');
    px(ctx, 13, 12, 2, 5, '#ffd35c');
  },
  passive_proj_speed: (ctx) => {
    px(ctx, 3, 13, 16, 3, '#ffd35c');
    px(ctx, 14, 8, 8, 3, 'rgba(255,211,92,0.6)');
    px(ctx, 14, 17, 8, 3, 'rgba(255,211,92,0.6)');
    px(ctx, 19, 10, 5, 3, '#fff6d8');
  },
  passive_magnet: (ctx) => {
    px(ctx, 8, 5, 5, 14, '#e05a5a');
    px(ctx, 15, 5, 5, 14, '#8fb4ff');
    px(ctx, 8, 19, 5, 5, '#f2f0e6');
    px(ctx, 15, 19, 5, 5, '#f2f0e6');
  },
  passive_regen: (ctx) => {
    circle(ctx, 14, 14, 11, '#59c97a');
    px(ctx, 12, 8, 4, 12, '#f2f0e6');
    px(ctx, 8, 12, 12, 4, '#f2f0e6');
  },
  passive_luck: (ctx) => {
    circle(ctx, 9, 10, 4, '#59c97a');
    circle(ctx, 19, 10, 4, '#59c97a');
    circle(ctx, 9, 19, 4, '#59c97a');
    circle(ctx, 19, 19, 4, '#59c97a');
    px(ctx, 13, 13, 2, 8, '#3a8a52');
  },
  passive_crit: (ctx) => {
    px(ctx, 12, 2, 4, 24, '#ffd35c');
    px(ctx, 2, 12, 24, 4, '#ffd35c');
    px(ctx, 6, 6, 4, 4, '#fff6d8');
    px(ctx, 18, 6, 4, 4, '#fff6d8');
    px(ctx, 6, 18, 4, 4, '#fff6d8');
    px(ctx, 18, 18, 4, 4, '#fff6d8');
  },
  passive_extra_projectile: (ctx) => {
    circle(ctx, 8, 10, 3, '#ffd35c');
    circle(ctx, 20, 10, 3, '#ffd35c');
    circle(ctx, 14, 19, 3, '#ffd35c');
  },
};

const cache = new Map<string, string>();

/** Data-URL for a small procedural icon matching an upgrade id (weapon or passive). Falls back to a generic sparkle for unmapped ids (new content added later). */
export function getUpgradeIconDataUrl(id: string): string {
  const cached = cache.get(id);
  if (cached) return cached;

  const { canvas, ctx } = newCanvas();
  const draw = DRAWERS[id] ?? DRAWERS.passive_crit;
  draw(ctx);
  const url = canvas.toDataURL();
  cache.set(id, url);
  return url;
}
