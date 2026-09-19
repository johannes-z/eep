import { createRoot } from 'react-dom/client';
import { App } from './App';
import styles from './styles.css';

void styles;

const root = document.getElementById('root');
if (!root) throw new Error('React root element is missing');

createRoot(root).render(<App />);
