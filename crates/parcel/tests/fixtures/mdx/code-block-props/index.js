import Mdx from './index.mdx';
import React from 'react';
import ReactDOM from 'react-dom/server.edge';

let codeBlockProps;
function CodeBlock(v) {
  codeBlockProps = v;
  return <pre>{v.children}</pre>;
}
let res = ReactDOM.renderToStaticMarkup(
  React.createElement(Mdx, {components: {CodeBlock}}),
);

output = {
  res,
  codeBlockProps
};
