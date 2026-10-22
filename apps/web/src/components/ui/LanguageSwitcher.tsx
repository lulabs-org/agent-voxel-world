import { useI18n } from '../../i18n';

interface LanguageSwitcherProps {
  className?: string;
  variant?: 'hud' | 'menu';
}

function GlobeIcon() {
  return (
    <svg
      className="language-switcher-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.5 14.5 0 0 1 0 18a14.5 14.5 0 0 1 0-18" />
    </svg>
  );
}

export function LanguageSwitcher({
  className = '',
  variant = 'hud',
}: LanguageSwitcherProps) {
  const { language, toggleLanguage, t } = useI18n();

  if (variant === 'menu') {
    return (
      <button
        type="button"
        className={`language-switcher-menu ${className}`}
        onClick={toggleLanguage}
        title={t('header.switchLanguage')}
      >
        <span className="language-switcher-menu-label">
          <GlobeIcon />
          {t('common.language')}
        </span>
        <small>{language === 'zh' ? 'English' : '简体中文'}</small>
      </button>
    );
  }

  if (variant === 'hud') {
    return (
      <button
        type="button"
        className={`language-switcher-hud ${className}`}
        onClick={toggleLanguage}
        aria-label={t('header.switchLanguage')}
        title={`${t('header.switchLanguage')} (${language === 'zh' ? 'English' : '简体中文'})`}
      >
        <GlobeIcon />
        {language === 'zh' ? 'EN' : '中'}
      </button>
    );
  }
}
