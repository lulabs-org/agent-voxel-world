import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../public/locales/en.json';
import zh from '../../public/locales/zh.json';

const STORAGE_KEY = 'voxel_lang';

function getInitialLanguage(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  }
  return 'zh';
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
});

if (typeof window !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lng);
    } catch {
      // Ignore storage errors
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lng === 'en' ? 'en' : 'zh-CN';
    }
  });
}

export default i18n;
