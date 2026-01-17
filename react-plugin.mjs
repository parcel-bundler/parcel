import babel from '@babel/core';
import compiler from 'babel-plugin-react-compiler';

export function transform(asset) {
  if (asset.url.includes('/node_modules/')) {
    return;
  }

  let content = asset.text();
  let res = babel.transformSync(content, {
    filename: asset.url,
    babelrc: false,
    configFile: false,
    browserslistConfigFile: false,
    parserOpts: {
      plugins: ['jsx']
    },
    plugins: [
      compiler
    ]
  });

  asset.setText(res.code);
}
