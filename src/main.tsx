import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import './index.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
  window.dispatchEvent(new Event('acropin-app-started'));
} else {
  document.body.innerHTML = '<main style="min-height:100vh;background:#020617;color:#f8fafc;display:grid;place-items:center;font:16px system-ui">Acropin could not load. Reload this page.</main>';
}
