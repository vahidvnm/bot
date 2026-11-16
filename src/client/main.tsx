import React from 'react';
import ReactDOM from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App.js';
import './index.css';

const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;
const isInsideTelegram = Boolean(window.Telegram?.WebApp?.initData || window.Telegram?.WebApp);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      actionsConfiguration={
        isInsideTelegram
          ? {
              twaReturnUrl: window.location.origin as `${string}://${string}`,
            }
          : undefined
      }
    >
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>
);
