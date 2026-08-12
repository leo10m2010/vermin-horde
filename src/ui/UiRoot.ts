import { getSettingsIconDataUrl, getUpgradeIconDataUrl } from './Icons';
import { createMenuBackdrop } from './MenuBackdrop';
import { getLang, setLang, t } from '../i18n';

export interface UpgradeOptionLike {
  id: string;
  name: string;
  description: string;
  kind?: string;
  fromLevel?: number;
  toLevel?: number;
  directionLabel?: string;
}

const UPGRADE_KIND_LABELS: Record<string, string> = {
  'new-weapon': 'Nueva arma',
  'weapon-level': 'Sube de nivel',
  passive: 'Pasiva',
};

export interface PauseWeaponEntry {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  evolved: boolean;
  evolvedName?: string;
  requirementName?: string;
  requirementOwned: boolean;
}

export interface PausePassiveEntry {
  id: string;
  name: string;
  count: number;
  maxStacks: number;
}

export interface PauseBuildInfo {
  characterName: string;
  level: number;
  weapons: PauseWeaponEntry[];
  passives: PausePassiveEntry[];
}

export interface UiCallbacks {
  onStartRun: () => void;
  onResumeRun: () => void;
  onRestartRun: () => void;
  onUpgradeChosen: (option: UpgradeOptionLike) => void;
  onOpenShop: () => void;
  onQuitToMenu: () => void;
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
  private pauseSubtitleEl!: HTMLElement;
  private pauseBuildEl!: HTMLElement;
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
      subtitle.textContent = t('Sobrevive a la horda. Sube de nivel. Aguanta.');
      const startBtn = this.buildButton(t('Comenzar'), 'ui-btn--primary', () => this.callbacks.onStartRun());
      const shopBtn = this.buildButton(t('Tienda'), 'ui-btn--secondary', () => this.callbacks.onOpenShop());
      const menuActions = document.createElement('div');
      menuActions.className = 'ui-menu-actions';
      menuActions.append(startBtn, shopBtn);
      panel.append(title, subtitle, menuActions);
      panel.append(this.buildSettingsIcon());
      return panel;
    });
    // Purely decorative atmosphere layer (drifting fog, embers, bat
    // silhouettes) prepended behind the menu panel. Lives entirely in its
    // own module (MenuBackdrop.ts) and is CSS-animated, so it never touches
    // the Three.js canvas/scene and needs no per-frame JS to pause/resume -
    // hiding the overlay already removes it from the render tree.
    this.mainMenuEl.prepend(createMenuBackdrop());

    this.pauseEl = this.buildOverlay('ui-pause', () => {
      const panel = this.buildPanel('ui-panel--wide');
      const heading = document.createElement('h2');
      heading.className = 'ui-heading';
      heading.textContent = t('Pausa');
      this.pauseSubtitleEl = document.createElement('p');
      this.pauseSubtitleEl.className = 'ui-subtitle';
      this.pauseBuildEl = document.createElement('div');
      this.pauseBuildEl.className = 'ui-build';
      const actions = document.createElement('div');
      actions.className = 'ui-menu-actions';
      const resumeBtn = this.buildButton(t('Reanudar'), 'ui-btn--primary', () => this.callbacks.onResumeRun());
      const menuBtn = this.buildButton(t('Menú Principal'), 'ui-btn--secondary', () => this.callbacks.onQuitToMenu());
      actions.append(resumeBtn, menuBtn);
      panel.append(heading, this.pauseSubtitleEl, this.pauseBuildEl, actions);
      return panel;
    });

    this.upgradeGridEl = document.createElement('div');
    this.upgradeGridEl.className = 'ui-upgrade-grid';
    this.upgradeEl = this.buildOverlay('ui-upgrade', () => {
      const panel = this.buildPanel('ui-panel--wide');
      const heading = document.createElement('h2');
      heading.className = 'ui-heading';
      heading.textContent = t('Elige una mejora');
      panel.append(heading, this.upgradeGridEl);
      return panel;
    });

    this.gameOverStatsEl = document.createElement('div');
    this.gameOverStatsEl.className = 'ui-stats';
    this.gameOverEl = this.buildOverlay('ui-gameover', () => {
      const panel = this.buildPanel();
      const heading = document.createElement('h2');
      heading.className = 'ui-heading ui-heading--warn';
      heading.textContent = t('Has caído');
      const againBtn = this.buildButton(t('Jugar de nuevo'), 'ui-btn--primary', () => this.callbacks.onRestartRun());
      const menuBtn = this.buildButton(t('Menú Principal'), 'ui-btn--secondary', () => this.callbacks.onQuitToMenu());
      panel.append(heading, this.gameOverStatsEl, againBtn, menuBtn);
      return panel;
    });

    this.victoryStatsEl = document.createElement('div');
    this.victoryStatsEl.className = 'ui-stats';
    this.victoryEl = this.buildOverlay('ui-victory', () => {
      const panel = this.buildPanel();
      const heading = document.createElement('h2');
      heading.className = 'ui-heading ui-heading--victory';
      heading.textContent = t('¡Victoria!');
      const againBtn = this.buildButton(t('Jugar de nuevo'), 'ui-btn--primary', () => this.callbacks.onRestartRun());
      const menuBtn = this.buildButton(t('Menú Principal'), 'ui-btn--secondary', () => this.callbacks.onQuitToMenu());
      panel.append(heading, this.victoryStatsEl, againBtn, menuBtn);
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

  showPause(build?: PauseBuildInfo): void {
    if (build) {
      this.pauseSubtitleEl.textContent = `${build.characterName} — ${t('Nivel')} ${build.level}`;
      this.pauseBuildEl.replaceChildren(...this.buildPauseSections(build));
    }
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
    el.textContent = `${t('JEFE:')} ${name}`;
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

  /**
   * Settings gear in the main menu's top-right corner, matching the
   * genre convention (Vampire Survivors and similar have a small settings
   * icon there). Opens a tiny panel with the two supported languages;
   * picking one persists it and reloads (see `setLang`) so every screen -
   * including ones not currently mounted - picks up the change consistently.
   */
  private buildSettingsIcon(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui-settings-wrap';

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'ui-settings-gear';
    gear.setAttribute('aria-label', t('Configuración'));
    gear.title = t('Configuración');
    const icon = document.createElement('img');
    icon.src = getSettingsIconDataUrl();
    icon.alt = '';
    gear.append(icon);

    const langPanel = document.createElement('div');
    langPanel.className = 'ui-settings-panel';
    langPanel.hidden = true;

    const langLabel = document.createElement('div');
    langLabel.className = 'ui-settings-label';
    langLabel.textContent = t('Idioma');
    langPanel.append(langLabel);

    const current = getLang();
    const esBtn = document.createElement('button');
    esBtn.type = 'button';
    esBtn.className = `ui-settings-lang${current === 'es' ? ' ui-settings-lang--active' : ''}`;
    esBtn.textContent = t('Español');
    esBtn.addEventListener('click', () => setLang('es'));

    const enBtn = document.createElement('button');
    enBtn.type = 'button';
    enBtn.className = `ui-settings-lang${current === 'en' ? ' ui-settings-lang--active' : ''}`;
    enBtn.textContent = t('Inglés');
    enBtn.addEventListener('click', () => setLang('en'));

    langPanel.append(esBtn, enBtn);

    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      langPanel.hidden = !langPanel.hidden;
    });
    document.addEventListener('click', () => {
      langPanel.hidden = true;
    });
    langPanel.addEventListener('click', (e) => e.stopPropagation());

    wrap.append(gear, langPanel);
    return wrap;
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
      this.buildStatRow(t('Tiempo sobrevivido'), formatClock(stats.survivedSeconds)),
      this.buildStatRow(t('Muertes'), String(stats.kills)),
      this.buildStatRow(t('Nivel alcanzado'), String(stats.level)),
    ];
    if (stats.goldEarned !== undefined) rows.push(this.buildStatRow(t('Oro ganado'), String(stats.goldEarned)));
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

  private buildPauseSections(build: PauseBuildInfo): HTMLElement[] {
    const columns = document.createElement('div');
    columns.className = 'ui-build-columns';

    const weaponsCol = document.createElement('div');
    weaponsCol.className = 'ui-build-col';
    const weaponsTitle = document.createElement('div');
    weaponsTitle.className = 'ui-build-col-title';
    weaponsTitle.textContent = `${t('Poderes')} (${build.weapons.length}/6)`;
    const weaponsList = document.createElement('div');
    weaponsList.className = 'ui-build-list';
    weaponsList.append(...build.weapons.map((w) => this.buildPauseWeaponRow(w)));
    weaponsCol.append(weaponsTitle, weaponsList);

    const passivesCol = document.createElement('div');
    passivesCol.className = 'ui-build-col';
    const passivesTitle = document.createElement('div');
    passivesTitle.className = 'ui-build-col-title';
    passivesTitle.textContent = `${t('Pasivas')} (${build.passives.length}/6)`;
    const passivesList = document.createElement('div');
    passivesList.className = 'ui-build-list';
    if (build.passives.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ui-build-empty';
      empty.textContent = t('Ninguna todavía');
      passivesList.append(empty);
    } else {
      passivesList.append(...build.passives.map((p) => this.buildPausePassiveRow(p)));
    }
    passivesCol.append(passivesTitle, passivesList);

    columns.append(weaponsCol, passivesCol);
    return [columns];
  }

  private buildPauseWeaponRow(w: PauseWeaponEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ui-build-row';

    const icon = document.createElement('img');
    icon.className = 'ui-build-icon';
    icon.src = getUpgradeIconDataUrl(w.id);
    icon.alt = '';
    row.append(icon);

    const info = document.createElement('div');
    info.className = 'ui-build-info';
    const name = document.createElement('div');
    name.className = 'ui-build-name';
    name.textContent = w.evolved && w.evolvedName ? t(w.evolvedName) : t(w.name);
    const level = document.createElement('div');
    level.className = 'ui-build-sub';
    level.textContent = `${t('Nivel')} ${w.level}/${w.maxLevel}`;
    info.append(name, level);
    row.append(info);

    const badge = document.createElement('div');
    if (w.evolved) {
      badge.className = 'ui-build-badge ui-build-badge--evolved';
      badge.textContent = t('EVOLUCIONADO');
    } else if (w.level >= w.maxLevel && w.requirementOwned) {
      badge.className = 'ui-build-badge ui-build-badge--ready';
      badge.textContent = t('LISTO PARA EVOLUCIONAR');
    } else if (w.requirementName) {
      badge.className = 'ui-build-badge ui-build-badge--requirement';
      badge.textContent = `${t('Requiere')}: ${t(w.requirementName)}`;
    }
    if (badge.textContent) row.append(badge);
    return row;
  }

  private buildPausePassiveRow(p: PausePassiveEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ui-build-row';

    const icon = document.createElement('img');
    icon.className = 'ui-build-icon';
    icon.src = getUpgradeIconDataUrl(p.id);
    icon.alt = '';
    row.append(icon);

    const info = document.createElement('div');
    info.className = 'ui-build-info';
    const name = document.createElement('div');
    name.className = 'ui-build-name';
    name.textContent = t(p.name);
    info.append(name);
    row.append(info);

    const badge = document.createElement('div');
    badge.className = 'ui-build-badge';
    badge.textContent = `${p.count}/${p.maxStacks}`;
    row.append(badge);
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

    const nameWrap = document.createElement('div');
    nameWrap.className = 'ui-upgrade-name-wrap';
    const name = document.createElement('div');
    name.className = 'ui-upgrade-name';
    name.textContent = t(option.name);
    nameWrap.append(name);

    // Exact level readout - "Nivel X -> Y" (or "Nueva" for a brand-new weapon)
    // so the player never has to guess what a pick actually does.
    if (option.toLevel !== undefined) {
      const levelLine = document.createElement('div');
      levelLine.className = 'ui-upgrade-level';
      if (option.kind === 'new-weapon') {
        levelLine.textContent = t('Nueva');
        levelLine.classList.add('ui-upgrade-level--new');
      } else {
        levelLine.textContent = `${t('Nivel')} ${option.fromLevel ?? 0} → ${option.toLevel}`;
      }
      nameWrap.append(levelLine);
    }
    header.append(nameWrap);

    card.append(header);

    if (option.kind) {
      const tag = document.createElement('div');
      tag.className = 'ui-upgrade-tag';
      tag.textContent = t(UPGRADE_KIND_LABELS[option.kind] ?? option.kind);
      card.append(tag);
    }

    if (option.directionLabel) {
      const dir = document.createElement('div');
      dir.className = 'ui-upgrade-direction';
      dir.textContent = t(option.directionLabel);
      card.append(dir);
    }

    const desc = document.createElement('div');
    desc.className = 'ui-upgrade-desc';
    desc.textContent = t(option.description);
    card.append(desc);

    card.addEventListener('click', () => {
      this.callbacks.onUpgradeChosen(option);
      this.hideUpgradePicker();
    });
    return card;
  }
}
