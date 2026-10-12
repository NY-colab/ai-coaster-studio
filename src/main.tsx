import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import WebApp from './WebApp';
import { hosted } from './connection';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{hosted ? <WebApp/> : <App/>}</React.StrictMode>);
