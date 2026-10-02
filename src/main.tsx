import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl && !rootEl.hasChildNodes()) {
  createRoot(rootEl).render(<App />);
}
