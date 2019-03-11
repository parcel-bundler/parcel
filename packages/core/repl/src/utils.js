// eslint-disable-next-line no-unused-vars
import {h} from 'preact';

export function hasBrowserslist(assets) {
  const configExists = assets.some(
    v => v.name === 'browserslist' || v.name === '.browserslistrc'
  );
  if (configExists) return true;

  const pkg = assets.find(v => v.name.endsWith('package.json'));
  try {
    const configInPackage =
      pkg && Boolean(JSON.parse(pkg.content).browserslist);
    return configInPackage;
  } catch (e) {
    return false;
  }
}

export function ParcelError(props) {
  let {highlightedCodeFrame, loc, fileName, message, stack} = props.error;
  // eslint-disable-next-line no-undef
  window.lastError = props.error;

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
      content: `import {Thing, x} from "./other.js";\nnew Thing().run();`,
      isEntry: true
    },
    {
      name: 'other.js',
      content: `class Thing {\n  run() {\n    console.log("Test");\n  } \n}\n\nconst x = 123;\nexport {Thing, x};`
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

export function Notes() {
  return (
    <div class="file notes">
      Yes, this is Parcel as a (nearly) self-hosting bundler (self-
      <i>hoisting</i> doesn't work ...)
      <br />
      The Parcel portion of this page, including all compilers, is a 2.2MB
      gzipped bundle running in a Web Worker
      <br />
      <br />
      Known issues:
      <ul>
        <li>
          Minifying CSS doesn't work (runtime <code>require</code> calls by
          cssnano, even for the config to disable the corresponding plugin...)
        </li>
        <li>
          Node builtin modules can't be polyfilled for the browser (looks up the
          bundler, caused by Parcel's <code>require.resolve</code> handling)
        </li>
        <li>
          Babel would need to <code>require</code> plugins at runtime (at least
          without workarounds)
        </li>
        <li>
          SASS importing is disabled for now (
          <a href="https://github.com/sass/dart-sass/issues/621">issue</a>)
        </li>
        <li>Generating source maps SASS throws an error</li>
      </ul>
    </div>
  );
}
