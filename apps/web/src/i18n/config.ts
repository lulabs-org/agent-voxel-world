import i18n, { type Callback, type TFunction } from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from './types';

const STORAGE_KEY = 'voxel_lang';

// Only the active dictionary is fetched up front; the others become chunks loaded on demand.
const loaders = {
  zh: () => import('./locales/zh.json').then((module) => module.default),
  en: () => import('./locales/en.json').then((module) => module.default),
} as const;

const catalogs = new Map<Language, Record<string, unknown>>();

function isLanguage(value: string): value is Language {
  return value === 'zh' || value === 'en';
}

async function loadCatalog(language: Language) {
  const cached = catalogs.get(language);
  if (cached) return cached;
  const catalog: Record<string, unknown> = await loaders[language]();
  catalogs.set(language, catalog);
  return catalog;
}

function getInitialLanguage(): Language {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && isLanguage(saved)) return saved;
  }
  return 'zh';
}

function applyDocumentLanguage(language: string) {
  if (typeof document !== 'undefined')
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
}

const initialLanguage = getInitialLanguage();

// A failed dictionary fetch must not blank the app; render keys and let a later
// language switch retry the load.
let initialCatalog: Record<string, unknown> = {};
try {
  initialCatalog = await loadCatalog(initialLanguage);
} catch (error) {
  console.error('无法加载语言字典，本次以键名渲染。', error);
}

// Top-level await keeps the instance ready for importers, so t() never renders raw keys.
await i18n.use(initReactI18next).init({
  resources: {
    [initialLanguage]: { translation: initialCatalog },
  },
  lng: initialLanguage,
  fallbackLng: initialLanguage,
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
});

const changeLanguage = i18n.changeLanguage.bind(i18n);

/**
 * Fetch the target dictionary before switching, so `i18n.changeLanguage()` never
 * exposes missing keys while the chunk is in flight.
 */
i18n.changeLanguage = (async (
  language?: string,
  callback?: Callback,
): Promise<TFunction> => {
  if (language && isLanguage(language)) {
    const catalog = await loadCatalog(language);
    i18n.addResourceBundle(language, 'translation', catalog, true, true);
  }
  return changeLanguage(language, callback);
}) as typeof i18n.changeLanguage;

applyDocumentLanguage(initialLanguage);

if (typeof window !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lng);
    } catch {
      // Ignore storage errors
    }
    applyDocumentLanguage(lng);
  });
}

export default i18n;
