import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import {privyAppId} from './config.js';
import './styles.css';

// Privy wallet login (as used in the course lab) loads only when an app ID is configured.
const PrivyRoot = lazy(() => import('./state/PrivyRoot.jsx'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {privyAppId
      ? <Suspense fallback={null}><PrivyRoot appId={privyAppId} /></Suspense>
      : <App privy={null} />}
  </StrictMode>,
);
