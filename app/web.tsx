import { createRoot } from 'react-dom/client';
import App from './App';
import './web.css';

// iOS Safari's keyboard changes the visual viewport without resizing 100dvh.
function fitViewport(): void {
  document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
}
fitViewport(); window.visualViewport?.addEventListener('resize', fitViewport); window.addEventListener('resize', fitViewport);
createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js').catch(() => {});
