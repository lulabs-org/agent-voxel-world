export type Language = 'zh' | 'en';

export interface LanguageOption {
  code: Language;
  label: string;
  shortLabel: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '简体中文', shortLabel: '中' },
  { code: 'en', label: 'English', shortLabel: 'EN' },
];

export type TranslationDictionary = {
  [key: string]: string | TranslationDictionary;
};

export interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}
