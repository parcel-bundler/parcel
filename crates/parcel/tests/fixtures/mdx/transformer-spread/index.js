import Mdx from './content.mdx';
import React from 'react';
import ReactDOM from 'react-dom/server.edge';

output = ReactDOM.renderToStaticMarkup(React.createElement(Mdx));
