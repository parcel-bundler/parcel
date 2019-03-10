// eslint-disable-next-line no-unused-vars
import {h} from 'preact';

import fs from '@parcel/fs';
import fsNative from 'fs';

let Bundler;
setTimeout(() => (Bundler = import('./parcel-vendor').then(v => v)), 200);

export async function bundle(assets, options) {
  fsNative.data = {};

  await fs.mkdirp('/src/');
  for (let f of assets) {
    await fs.writeFile(`/src/${f.name}`, f.content);
  }

  const entryPoints = assets
    .filter(v => v.isEntry)
    .map(v => v.name)
    .map(v => `/src/${v}`);

  if (!entryPoints.length) throw new Error('No asset marked as entrypoint');

  const bundler = new (await Bundler)(entryPoints, {
    outDir: '/dist',
    autoinstall: false,
    watch: false,
    cache: true,
    hmr: false,
    logLevel: 0,
    minify: options.minify,
    scopeHoist: options.scopeHoist,
    sourceMaps: options.sourceMaps
  });

  const bundle = await bundler.bundle();

  const output = [];
  for (let f of await fs.readdir('/dist')) {
    output.push({
      name: f,
      content: await fs.readFile('/dist/' + f, 'utf8')
    });
  }
  return output;
}

export function ParcelError(props) {
  let {highlightedCodeFrame, loc, fileName, message, stack} = props.children;
  // eslint-disable-next-line no-undef
  window.lastError = props.children;

  fileName = fileName
    ? fileName.replace(/^\/src\//, '') +
      (loc && loc.line ? `:${loc.line}:${loc.column}:` : ':')
    : '';
  highlightedCodeFrame = highlightedCodeFrame || '';
  stack = (!highlightedCodeFrame && stack) || '';
  return (
    <div class="file error">
      {`${fileName} ${message}\n${highlightedCodeFrame}\n${stack}`.trim()}
    </div>
  );
}

export const PRESETS = {
  Javascript: [
    {
      name: 'index.js',
      content: `import {a, x} from "./other.js";\nconsole.log(x);`,
      isEntry: true
    },
    {
      name: 'other.js',
      content: `function a(){return "asd";}\nconst x = 123;\nexport {a, x};`
    }
  ],
  Babel: [
    {
      name: 'index.js',
      content: `const {a, b} = {a: 2, b: 3};\nconsole.log(a);`,
      isEntry: true
    },
    {
      name: '.babelrc',
      content: `{ presets: ["@babel/env"] }`
    },
    {
      name: 'package.json',
      content: `{\n "devDependencies": {\n  "@babel/core": "^7.3.4",\n  "@babel/preset-env": "^7.3.4"\n  }\n}`
    }
  ],
  "Basic Page (don't minify!)": [
    {
      name: 'index.html',
      content: `<link rel="stylesheet" type="text/css" href="./style.css">\n<script src="./index.js"></script>`,
      isEntry: true
    },
    {
      name: 'index.js',
      content: `function a(){\n return "asd";\n}\ndocument.body.innerText += a();`
    },
    {
      name: 'style.css',
      content: `body {\n  color: red;\n}`
    }
  ],
  JSON: [
    {
      name: 'index.js',
      content: "import x from './test.json';\nconsole.log(x);",
      isEntry: true
    },
    {name: 'test.json', content: '{a: 2, b: 3}'}
  ],
  Typescript: [
    {
      name: 'index.ts',
      content: `function greeter(person: string) {
    return "Hello, " + person;
}

let user = "Jane User";

document.body.innerHTML = greeter(user);
`,
      isEntry: true
    }
  ],
  "Markdown (don't minify!)": [
    {
      name: 'Article.md',
      content: '# My Title\n\nHello, ...\n\n```js\nconsole.log("test");\n```\n',
      isEntry: true
    }
  ],
  //   "Vue (don't minify!)": [
  //     {
  //       name: 'index.html',
  //       content: `<!DOCTYPE html>
  // <html lang="en">
  //   <head>
  //     <title>Parcel - Vue</title>
  //   </head>
  //   <body>
  //     <div id="app"></div>
  //     <script src="./index.js"></script>
  //   </body>
  // </html>`,
  //       isEntry: true
  //     },
  //     {
  //       name: 'index.js',
  //       content: `import Vue from 'vue';
  // import App from './app.vue';

  // new Vue(App).$mount('#app')`
  //     },
  //     {
  //       name: `app.vue`,
  //       content: `<template>
  //   .container Hello {{bundler}}
  // </template>

  // <script>
  // import Vue from "vue";
  // export default Vue.extend({
  //   data() {
  //     return {
  //       bundler: "Parcel"
  //     };
  //   }
  // });
  // </script>

  // <style scoped>
  // .container {
  //   color: green;
  // }
  // </style>`
  //     }
  //   ]
  "SCSS (don't minify!)": [
    {
      name: 'style.scss',
      content: `$colorRed: red;
#header {
  margin: 0;
  border: 1px solid $colorRed;
  p {
    color: $colorRed;
    font: {
      size: 12px;
      weight: bold;
    }
  }
  a {
    text-decoration: none;
  }
}`,
      isEntry: true
    }
  ],
  "LESS (don't minify!)": [
    {
      name: 'style.less',
      content: `@some-color: #143352;

#header {
  background-color: @some-color;
}
h2 {
  color: @some-color;
}`,
      isEntry: true
    }
  ]
};
