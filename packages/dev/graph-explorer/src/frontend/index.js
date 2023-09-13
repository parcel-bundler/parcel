// @flow

import * as React from 'react';
import ReactDOM from 'react-dom/client';
import RelayEnvironment from './RelayEnvironment';
import {AppStateProvider} from './AppState';
import App from './components/App';

const root = ReactDOM.createRoot(document.getElementById('react-root'));
root.render(
  <RelayEnvironment>
    <React.Suspense fallback={<div>loading...</div>}>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </React.Suspense>
  </RelayEnvironment>,
);
