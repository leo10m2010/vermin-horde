import { getSettingsIconDataUrl, getUpgradeIconDataUrl } from './Icons';
import { getLang, setLang, t } from '../i18n';

export interface UpgradeOptionLike {
  id: string;
  name: string;
  description: string;
  kind?: string;
  fromLevel?: number;
  toLevel?: number;
  directionLabel?: string;
  /** Concrete before/after readout, e.g. "2 → 3 proyectiles". Derived from the weapon's own progression table. */
  detail?: string;
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
  /**
   * Share of total run damage per weapon, biggest first. This is the single
   * most build-legible number a survivors run can show the player - "Fireball
   * 31%, Garlic 24%" tells them what actually carried them far better than
   * kills or level do.
   */
  damageByPower?: Array<{ id: string; name: string; percent: number }>;
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
  private menuActionsEl!: HTMLElement;
  private evolutionEl!: HTMLElement;
  private evolutionTimer: number | undefined;

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

      this.menuActionsEl = document.createElement('div');
      this.menuActionsEl.className = 'ui-menu-actions';
      panel.append(title, subtitle, this.menuActionsEl);
      panel.append(this.buildSettingsIcon());
      return panel;
    });
    // The panel is laid out to one side (see .ui-overlay--menu in styles.css)
    // rather than centred, so the Three.js MenuScene behind it stays visible
    // instead of being covered by a full-width slab.
    this.mainMenuEl.classList.add('ui-overlay--menu');
    // NOTE: the menu's fog / embers / bats used to be a second, CSS-animated
    // DOM layer here (MenuBackdrop.ts) drawn on top of the Three.js MenuScene,
    // which already renders its own fog and embers. Two atmosphere systems
    // competing in front of each other never read as one composition, so the
    // DOM layer is gone and MenuScene now owns all of it - including the bats,
    // which live at real depths and weave behind the tombstones. The DOM keeps
    // UI only.

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

    // Evolution banner: its own element rather than the generic toast, so the
    // moment gets a real presentation - flash, icon, base name struck through
    // into the evolved name - without blocking the run. Total ~1.6s, and the
    // simulation keeps running underneath the whole time.
    this.evolutionEl = document.createElement('div');
    this.evolutionEl.className = 'ui-evolution';
    this.evolutionEl.hidden = true;
    this.root.append(this.evolutionEl);
  }

  /**
   * Plays the weapon-evolution flourish. Deliberately short and non-blocking:
   * an evolution should feel like a reward, not an interruption.
   */
  showEvolution(info: { id: string; fromName: string; toName: string }): void {
    window.clearTimeout(this.evolutionTimer);
    this.evolutionEl.replaceChildren();

    const flash = document.createElement('div');
    flash.className = 'ui-evolution-flash';

    const card = document.createElement('div');
    card.className = 'ui-evolution-card';

    const icon = document.createElement('img');
    icon.className = 'ui-evolution-icon';
    icon.src = getUpgradeIconDataUrl(info.id);
    icon.alt = '';

    const text = document.createElement('div');
    text.className = 'ui-evolution-text';
    const tag = document.createElement('div');
    tag.className = 'ui-evolution-tag';
    tag.textContent = t('EVOLUCIÓN');
    const names = document.createElement('div');
    names.className = 'ui-evolution-names';
    const from = document.createElement('span');
    from.className = 'ui-evolution-from';
    from.textContent = t(info.fromName);
    const arrow = document.createElement('span');
    arrow.className = 'ui-evolution-arrow';
    arrow.textContent = '→';
    const to = document.createElement('span');
    to.className = 'ui-evolution-to';
    to.textContent = t(info.toName);
    names.append(from, arrow, to);
    text.append(tag, names);

    card.append(icon, text);
    this.evolutionEl.append(flash, card);
    this.evolutionEl.hidden = false;
    // Restart the CSS animation on a repeat evolution.
    void this.evolutionEl.offsetWidth;
    this.evolutionEl.classList.add('ui-evolution--playing');
    this.evolutionTimer = window.setTimeout(() => {
      this.evolutionEl.classList.remove('ui-evolution--playing');
      this.evolutionEl.hidden = true;
    }, 1700);
  }

  /**
   * `canContinue` adds a CONTINUAR entry at the top when a run is paused and
   * can still be resumed. Buttons are rebuilt per show (not hidden/unhidden)
   * so the stagger index stays correct whichever set is present.
   */
  showMainMenu(options: { canContinue?: boolean } = {}): void {
    const buttons: HTMLElement[] = [];
    if (options.canContinue) {
      buttons.push(this.buildButton(t('Continuar'), 'ui-btn--primary', () => this.callbacks.onResumeRun()));
      buttons.push(this.buildButton(t('Jugar'), 'ui-btn--secondary', () => this.callbacks.onStartRun()));
    } else {
      buttons.push(this.buildButton(t('Jugar'), 'ui-btn--primary', () => this.callbacks.onStartRun()));
    }
    buttons.push(this.buildButton(t('Personajes'), 'ui-btn--secondary', () => this.callbacks.onStartRun()));
    buttons.push(this.buildButton(t('Mejoras'), 'ui-btn--secondary', () => this.callbacks.onOpenShop()));
    buttons.forEach((btn, i) => btn.style.setProperty('--btn-index', String(i)));
    this.menuActionsEl.replaceChildren(...buttons);
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
    const cards = options.map((option, i) => {
      const card = this.buildUpgradeCard(option);
      // Staggered entrance (~60ms apart) so the row reads left-to-right
      // instead of all three snapping in at once. Driven by a CSS custom
      // property rather than JS timers, so `prefers-reduced-motion` in
      // styles.css can flatten it to zero without any JS branch.
      card.style.setProperty('--card-index', String(i));
      return card;
    });
    this.upgradeGridEl.replaceChildren(...cards);
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
    if (stats.damageByPower && stats.damageByPower.length > 0) {
      rows.push(this.buildDamageBreakdown(stats.damageByPower));
    }
    return rows;
  }

  /** Ranked damage-share bars, one row per weapon that contributed. */
  private buildDamageBreakdown(entries: Array<{ id: string; name: string; percent: number }>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui-damage-breakdown';

    const heading = document.createElement('div');
    heading.className = 'ui-damage-heading';
    heading.textContent = t('Daño por poder');
    wrap.append(heading);

    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'ui-damage-row';

      const icon = document.createElement('img');
      icon.className = 'ui-damage-icon';
      icon.src = getUpgradeIconDataUrl(entry.id);
      icon.alt = '';
      row.append(icon);

      const name = document.createElement('span');
      name.className = 'ui-damage-name';
      name.textContent = t(entry.name);
      row.append(name);

      const bar = document.createElement('span');
      bar.className = 'ui-damage-bar';
      const fill = document.createElement('span');
      fill.className = 'ui-damage-fill';
      fill.style.width = `${Math.max(2, Math.round(entry.percent))}%`;
      bar.append(fill);
      row.append(bar);

      const pct = document.createElement('span');
      pct.className = 'ui-damage-pct';
      pct.textContent = `${Math.round(entry.percent)}%`;
      row.append(pct);

      wrap.append(row);
    }
    return wrap;
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

    // Secondary line: the literal numbers behind the headline ("2 → 3
    // proyectiles"). Comes from the weapon's progression table, so it is the
    // same value the simulation will use after the pick.
    if (option.detail) {
      const detail = document.createElement('div');
      detail.className = 'ui-upgrade-detail';
      detail.textContent = t(option.detail);
      card.append(detail);
    }

    card.addEventListener('click', () => {
      this.callbacks.onUpgradeChosen(option);
      this.hideUpgradePicker();
    });
    return card;
  }
}
