import Mdx from './index.mdx';
import React from 'react';
import ReactDOM from 'react-dom/server.edge';

output = ReactDOM.renderToStaticMarkup(
  React.createElement(Mdx),
);
