import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { Connection } from './network/connection';
import './styles/main.css';
// HUD overrides the shared surfaces; keep this stylesheet last.
import './features/hud/hud.css';

const connection = new Connection();
if (import.meta.hot) import.meta.hot.dispose(() => connection.dispose());
createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App connection={connection} />
  </I18nProvider>,
);

