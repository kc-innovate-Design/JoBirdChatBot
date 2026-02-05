import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initFirebase } from './lib/firebase';
import { loadConfig } from './lib/config';

async function bootstrap() {
  // 1. Load configuration (runtime or build-time)
  await loadConfig();

  // 2. Initialize Firebase
  initFirebase();

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Could not find root element to mount to");
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap().catch(console.error);
