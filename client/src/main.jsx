import React from 'react';
import ReactDOM from 'react-dom/client';
// Configure bundled Monaco + workers before any editor mounts (must be first).
import './monaco/monacoSetup.js';
import './index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
