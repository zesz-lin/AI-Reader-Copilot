import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}
