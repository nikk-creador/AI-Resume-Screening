import React from 'react';
import { ConfigProvider } from 'antd';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';

import { GoogleOAuthProvider } from '@react-oauth/google';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { COLORS } from './theme/colors';
import App from './App';
import { store } from './store';

import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import './styles.css';

for (const [name, value] of Object.entries(COLORS)) {
  const tokenName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  document.documentElement.style.setProperty(`--color-${tokenName}`, value);
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found.');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <GoogleOAuthProvider
      clientId={
        import.meta.env.VITE_GOOGLE_CLIENT_ID ||
        '443288765564-ileiomf2qvgvl8t0renuqbtnsjuhnvdf.apps.googleusercontent.com'
      }
    >
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ConfigProvider
              theme={{
                token: {
                  colorPrimary: COLORS.primary,
                  borderRadius: 8,
                  fontFamily:
                    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                },
              }}
            >
              <App />
            </ConfigProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </Provider>
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
