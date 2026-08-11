import { getUpgradeIconDataUrl } from './Icons';

export interface UpgradeOptionLike {
  id: string;
  name: string;
  description: string;
  kind?: string;
}

export interface UiCallbacks {
  onStartRun: () => void;
  onResumeRun: () => void;
  onRestartRun: () => void;
  onUpgradeChosen: (option: UpgradeOptionLike) => void;
  onOpenShop: () => void;
}

interface RunSummaryStats {
  survivedSeconds: number;
  kills: number;
  level: number;
  goldEarned?: number;
}

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(clamped / 60).toString().padStart(2, '0');
  const s = Math.floor(clamped % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Facade over every menu/overlay hosted in `#ui-root`: main menu, pause, the
 * level-up upgrade picker, and the game-over/victory summary screens, plus
 * the boss banner (`#boss-banner`, already present in index.html). Built
 * once by the director. Every overlay toggles the `hidden` attribute (never
 * just opacity) so an idle overlay is fully removed from layout/hit-testing
 * and can never eat a click meant for the canvas or touch controls.
 */
export class UiRoot {
  private readonly mainMenuEl: HTMLElement;
  private readonly pauseEl: HTMLElement;
  private readonly upgradeEl: HTMLElement;
  private readonly upgradeGridEl: HTMLElement;
  private readonly gameOverEl: HTMLElement;
  private readonly gameOverStatsEl: HTMLElement;
  private readonly victoryEl: HTMLElement;
  private readonly victoryStatsEl: HTMLElement;
  private readonly bossBannerEl: HTMLElement | null;
  private bossBannerTimer: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: UiCallbacks,
  ) {
    this.root.classList.add('ui-root-managed');

    this.mainMenuEl = this.buildOverlay('ui-main-menu', () => {
      const panel = this.buildPanel('ui-panel--menu');
      const title = document.createElement('h1');
      title.className = 'ui-title';
      title.textContent = 'VERMIN HORDE';
      const subtitle = document.createElement('p');
      subtitle.className = 'ui-subtitle';
      subtitle.textContent = 'Sobrevive a la horda. Sube de nivel. Aguanta.';
      const startBtn = this.buildButton('Comenzar', 'ui-btn--primary', () => this.callbacks.onStartRun());
      const shopBtn = this.buildButton('Tienda', 'ui-btn--secondary', () => this.callbacks.onOpenShop());
      const menuActions = document.createElement('div');
      menuActions.className = 'ui-menu-actions';
      menuActions.append(startBtn, shopBtn);
      panel.append(title, subtitle, menuActions);
      return panel;
    });

    this.pauseEl = this.buildOverlay('ui-pause', () => {
      const panel = this.buildPanel();
      const heading = document.createElement('h2');
      heading.className = 'ui-heading';
      heading.textContent = 'Pausa';
      const resumeBtn = this.buildButton('Reanudar', 'ui-btn--primary', () => this.callbacks.onResumeRun());
      panel.append(heading, resumeBtn);
      return panel;
    });

    this.upgradeGridEl = document.createElement('div');
    this.upgradeGridEl.className = 'ui-upgrade-grid';
    this.upgradeEl = this.buildOverlay('ui-upgrade', () => {
      const panel = this.buildPanel('ui-panel--wide');
      const heading = document.createElement('h2');
      heading.className = 'ui-heading';
      heading.textContent = 'Elige una mejora';
      panel.append(heading, this.upgradeGridEl);
      return panel;
    });

    this.gameOverStatsEl = document.createElement('div');
    this.gameOverStatsEl.className = 'ui-stats';
    this.gameOverEl = this.buildOverlay('ui-gameover', () => {
      const panel = this.buildPanel();
      const heading = document.createElement('h2');
      heading.className = 'ui-heading ui-heading--warn';
      heading.textContent = 'Has caído';
      const againBtn = this.buildButton('Jugar de nuevo', 'ui-btn--primary', () => this.callbacks.onRestartRun());
      panel.append(heading, this.gameOverStatsEl, againBtn);
      return panel;
    });

    this.victoryStatsEl = document.createElement('div');
    this.victoryStatsEl.className = 'ui-stats';
    this.victoryEl = this.buildOverlay('ui-victory', () => {
      const panel = this.buildPanel();
      const heading = document.createElement('h2');
      heading.className = 'ui-heading ui-heading--victory';
      heading.textContent = '¡Victoria!';
      const againBtn = this.buildButton('Jugar de nuevo', 'ui-btn--primary', () => this.callbacks.onRestartRun());
      panel.append(heading, this.victoryStatsEl, againBtn);
      return panel;
    });

    this.bossBannerEl = document.querySelector<HTMLElement>('#boss-banner');
  }

  showMainMenu(): void {
    this.show(this.mainMenuEl);
  }

  hideMainMenu(): void {
    this.hide(this.mainMenuEl);
  }

  showPause(): void {
    this.show(this.pauseEl);
  }

  hidePause(): void {
    this.hide(this.pauseEl);
  }

  showUpgradePicker(options: UpgradeOptionLike[]): void {
    this.upgradeGridEl.replaceChildren(...options.map((option) => this.buildUpgradeCard(option)));
    this.show(this.upgradeEl);
  }

  hideUpgradePicker(): void {
    this.hide(this.upgradeEl);
    this.upgradeGridEl.replaceChildren();
  }

  showGameOver(stats: RunSummaryStats): void {
    this.gameOverStatsEl.replaceChildren(...this.buildStatRows(stats));
    this.show(this.gameOverEl);
  }

  showVictory(stats: RunSummaryStats): void {
    this.victoryStatsEl.replaceChildren(...this.buildStatRows(stats));
    this.show(this.victoryEl);
  }

  showBossBanner(name: string): void {
    const el = this.bossBannerEl;
    if (!el) return;
    el.textContent = `JEFE: ${name}`;
    el.hidden = false;
    // Restart the CSS entrance animation on every call (even re-triggers for
    // a new boss while the banner is already visible) by removing the class,
    // forcing a reflow, then re-adding it.
    el.classList.remove('boss-banner-enter');
    void el.offsetWidth;
    el.classList.add('boss-banner-enter');
    if (this.bossBannerTimer !== undefined) window.clearTimeout(this.bossBannerTimer);
    this.bossBannerTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 2500);
  }

  hideAll(): void {
    this.hideMainMenu();
    this.hidePause();
    this.hideUpgradePicker();
    this.hide(this.gameOverEl);
    this.hide(this.victoryEl);
    if (this.bossBannerEl) {
      this.bossBannerEl.hidden = true;
      if (this.bossBannerTimer !== undefined) {
        window.clearTimeout(this.bossBannerTimer);
        this.bossBannerTimer = undefined;
      }
    }
  }

  /**
   * Ornate gothic panel shell: base `.ui-panel` box plus a `.ui-panel-corners`
   * wrapper holding four small gold corner accents (`.ui-corner`), positioned
   * purely via CSS `inset`/corner offsets so it works at any panel size.
   * Every overlay panel goes through this so the framing stays consistent.
   */
  private buildPanel(extraClass?: string): HTMLElement {
    const panel = document.createElement('div');
    panel.className = extraClass ? `ui-panel ${extraClass}` : 'ui-panel';
    const corners = document.createElement('div');
    corners.className = 'ui-panel-corners';
    for (const cornerClass of ['ui-corner--tl', 'ui-corner--tr', 'ui-corner--bl', 'ui-corner--br']) {
      const corner = document.createElement('i');
      corner.className = `ui-corner ${cornerClass}`;
      corners.append(corner);
    }
    panel.append(corners);
    return panel;
  }

  private buildOverlay(id: string, buildContent: () => HTMLElement): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'ui-overlay';
    overlay.hidden = true;
    overlay.append(buildContent());
    this.root.append(overlay);
    return overlay;
  }

  private show(overlay: HTMLElement): void {
    overlay.hidden = false;
  }

  private hide(overlay: HTMLElement): void {
    overlay.hidden = true;
  }

  private buildButton(label: string, extraClass: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ui-btn ${extraClass}`;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private buildStatRows(stats: RunSummaryStats): HTMLElement[] {
    const rows = [
      this.buildStatRow('Tiempo sobrevivido', formatClock(stats.survivedSeconds)),
      this.buildStatRow('Muertes', String(stats.kills)),
      this.buildStatRow('Nivel alcanzado', String(stats.level)),
    ];
    if (stats.goldEarned !== undefined) rows.push(this.buildStatRow('Oro ganado', String(stats.goldEarned)));
    return rows;
  }

  private buildStatRow(label: string, value: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ui-stat-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'ui-stat-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'ui-stat-value';
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    return row;
  }

  private buildUpgradeCard(option: UpgradeOptionLike): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ui-upgrade-card';

    const header = document.createElement('div');
    header.className = 'ui-upgrade-header';

    const icon = document.createElement('img');
    icon.className = 'ui-upgrade-icon';
    icon.src = getUpgradeIconDataUrl(option.id);
    icon.alt = '';
    header.append(icon);

    const name = document.createElement('div');
    name.className = 'ui-upgrade-name';
    name.textContent = option.name;
    header.append(name);

    card.append(header);

    if (option.kind) {
      const tag = document.createElement('div');
      tag.className = 'ui-upgrade-tag';
      tag.textContent = option.kind;
      card.append(tag);
    }

    const desc = document.createElement('div');
    desc.className = 'ui-upgrade-desc';
    desc.textContent = option.description;
    card.append(desc);

    card.addEventListener('click', () => {
      this.callbacks.onUpgradeChosen(option);
      this.hideUpgradePicker();
    });
    return card;
  }
}
