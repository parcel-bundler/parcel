import ReactDOM from 'react-dom';
import React from 'react';
import MDX from './README.md';

ReactDOM.render(
  <div>
    {' '}
    <MDX />{' '}
  </div>,
  // React.createElement('div', null, `Hello World`),
  document.getElementById('root')
);
