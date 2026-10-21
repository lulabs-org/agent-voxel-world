import { useI18n } from '../../i18n';

interface LanguageSwitcherProps {
  className?: string;
  variant?: 'header' | 'hud' | 'menu';
}

export function LanguageSwitcher({
  className = '',
  variant = 'header',
}: LanguageSwitcherProps) {
  const { language, toggleLanguage, setLanguage, t } = useI18n();

  if (variant === 'menu') {
    return (
      <button
        type="button"
        className={`language-switcher-menu ${className}`}
        onClick={toggleLanguage}
        title={t('header.switchLanguage')}
      >
        <span>🌐 {t('common.language')}</span>
        <small style={{ marginLeft: 'auto', opacity: 0.8 }}>
          {language === 'zh' ? 'English' : '简体中文'}
        </small>
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
        <span aria-hidden="true" style={{ marginRight: 3 }}>
          🌐
        </span>
        {language === 'zh' ? 'EN' : '中'}
      </button>
    );
  }

  return (
    <div
      className={`language-switcher-pill ${className}`}
      role="group"
      aria-label={t('header.switchLanguage')}
    >
      <button
        type="button"
        className={language === 'zh' ? 'active' : ''}
        onClick={() => setLanguage('zh')}
        aria-pressed={language === 'zh'}
      >
        中
      </button>
      <span className="divider" aria-hidden="true">
        /
      </span>
      <button
        type="button"
        className={language === 'en' ? 'active' : ''}
        onClick={() => setLanguage('en')}
        aria-pressed={language === 'en'}
      >
        EN
      </button>
    </div>
  );
}
