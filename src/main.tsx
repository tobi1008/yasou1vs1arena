import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl && !(window as unknown as { __yasuoRoot?: ReturnType<typeof createRoot> }).__yasuoRoot) {
  const root = createRoot(rootEl);
  (window as unknown as { __yasuoRoot?: ReturnType<typeof createRoot> }).__yasuoRoot = root;
  root.render(<App />);
}
