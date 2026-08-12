// Minimal i18n: Spanish and English only, toggled from a settings icon in
// the main menu. UI chrome was originally authored in Spanish; weapon/
// passive/character/arcana content was originally authored in English -
// rather than rewrite every data file to key off translation ids, `t()`
// just looks up whichever direction is needed against the string ALREADY
// hardcoded in source, and falls back to that original string untouched if
// no entry exists yet. This keeps every existing call site a one-line
// `t('original text')` wrap instead of a data-shape migration.
//
// Switching language reloads the page (`setLang`) rather than trying to
// live-repaint every open overlay - simplest reliable way to guarantee
// every screen (including ones not currently mounted) picks up the new
// language consistently.

export type Lang = 'es' | 'en';

const STORAGE_KEY = 'vermin-horde-lang';

/** Spanish source string -> English translation. */
const ES_TO_EN: Record<string, string> = {};

/** English source string -> Spanish translation. */
const EN_TO_ES: Record<string, string> = {};

/** Register translation pairs. `es` is the Spanish text as it appears in source, `en` its English translation. */
export function registerTranslations(pairs: Array<{ es: string; en: string }>): void {
  for (const { es, en } of pairs) {
    ES_TO_EN[es] = en;
    EN_TO_ES[en] = es;
  }
}

let currentLang: Lang = loadLang();

/** Translate `text` (as hardcoded in source, in whichever language it was authored) into the current language. */
export function t(text: string): string {
  if (!text) return text;
  if (currentLang === 'en') return ES_TO_EN[text] ?? text;
  return EN_TO_ES[text] ?? text;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Private browsing / disabled storage: the reload below will just fall
    // back to Spanish again next load, which is an acceptable degrade.
  }
  location.reload();
}

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // ignore
  }
  return 'es';
}
