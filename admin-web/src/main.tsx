import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

document.title = `${import.meta.env.VITE_SHOP_NAME || 'Open Shop'} 管理后台`;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
