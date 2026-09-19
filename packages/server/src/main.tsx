import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import styles from './styles.css';
import { router } from './ui/router';

void styles;

const root = document.getElementById('root');
if (!root) throw new Error('React root element is missing');

createRoot(root).render(<RouterProvider router={router} />);
