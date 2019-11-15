import React from 'react';
import {render} from 'react-dom';
import App from './App';

render(
  <>
    <h1>Toplevel has {Math.random()}</h1>
    <App />
  </>,
  document.getElementById('root')
);
