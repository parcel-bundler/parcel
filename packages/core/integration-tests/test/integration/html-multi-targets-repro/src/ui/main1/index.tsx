import { setGlobalTheme } from '@atlaskit/tokens';
import React from 'react';
import ReactDOM from 'react-dom';

const App = () => <div/>;

const renderApp = () => {
  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById('root')
  );
};

setGlobalTheme({ colorMode: 'light' })
  .then(() => {
    renderApp();
  })
  .catch((e) => {
    renderApp();
    console.log('error setting theme', e);
  });
