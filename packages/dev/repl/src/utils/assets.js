// @flow
type Asset = {|
  name: string,
  content: string,
  isEntry?: boolean,
|};
export type AssetDiagnostics = Map<string, CodeMirrorDiagnostic>;

export type Assets = Array<Asset>;

export type CodeMirrorDiagnostic = {|
  from: number,
  to: number,
  severity: 'info' | 'warning' | 'error',
  source: string,
  message: string,
|};

export type AssetAction =
  | {|
      type: 'updateAsset',
      name: string,
      prop: 'isEntry',
      value: $PropertyType<Asset, 'isEntry'>,
    |}
  | {|
      type: 'updateAsset',
      name: string,
      prop: string,
      value: string,
    |}
  | {|
      type: 'removeAsset',
      name: string,
    |}
  | {|
      type: 'setAssets',
      assets: Assets,
    |}
  | {|
      type: 'addAsset',
    |};

export function updateAssets(
  assets: Assets,
  name: string,
  prop: string,
  value: mixed,
): Assets {
  return assets.map(a => (a.name === name ? {...a, [prop]: value} : a));
}
export function assetsReducer(assets: Assets, action: AssetAction): Assets {
  if (action.type === 'setAssets') {
    return action.assets;
  } else if (action.type === 'updateAsset') {
    const {name, prop, value} = action;
    if (prop === 'name' && assets.find(a => a.name === value)) {
      return [...assets];
    } else {
      if (prop === 'content') {
        assets = updateAssets(assets, name, 'time', Date.now());
      }
      return updateAssets(assets, name, prop, value);
    }
  } else if (action.type === 'removeAsset') {
    const {name} = action;
    return assets.filter(a => a.name !== name);
  } else if (action.type === 'addAsset') {
    let nameIndex = 0;
    while (
      assets.find(
        v => v.name == 'new' + (nameIndex ? `-${nameIndex}` : '') + '.js',
      )
    ) {
      nameIndex++;
    }

    return [
      ...assets,
      {
        name: 'new' + (nameIndex ? `-${nameIndex}` : '') + '.js',
        content: '',
        isEntry: false,
      },
    ];
  }

  throw new Error('Unknown action');
}
assetsReducer.setAssets = (assets: Assets): AssetAction => ({
  type: 'setAssets',
  assets,
});
assetsReducer.changeName = (name: string, newName: string): AssetAction => ({
  type: 'updateAsset',
  name,
  prop: 'name',
  value: newName,
});
assetsReducer.changeContent = (name: string, content: string): AssetAction => ({
  type: 'updateAsset',
  name,
  prop: 'content',
  value: content,
});
assetsReducer.changeEntry = (name: string, isEntry: boolean): AssetAction => ({
  type: 'updateAsset',
  name,
  prop: 'isEntry',
  value: isEntry,
});
assetsReducer.remove = (name: string): AssetAction => ({
  type: 'removeAsset',
  name,
});
assetsReducer.add = (): AssetAction => ({type: 'addAsset'});

export const ASSET_PRESETS: {|[string]: Assets|} = {
  Javascript: [
    {
      name: 'src/index.js',
      content: `import {Thing, x} from "./other.js";\nnew Thing().run();`,
      isEntry: true,
    },
    {
      name: 'src/other.js',
      content: `class Thing {\n  run() {\n    console.log("Test");\n  } \n}\n\nconst x = 123;\nexport {Thing, x};`,
    },
  ],
  Babel: [
    {
      name: 'src/index.js',
      content: `class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    toString() {
        return \`(\${this.x}, \${this.y})\`;
    }
}

console.log(new Point(1,2).toString());
`,
      isEntry: true,
    },
    {
      name: '.babelrc',
      content: `{ "presets": [["@babel/env", {"loose": true}]] }`,
    },
    // {
    //   name: 'src/package.json',
    //   content: `{\n "devDependencies": {\n  "@babel/core": "^7.3.4",\n  "@babel/preset-env": "^7.3.4"\n  }\n}`,
    // },
  ],
  'Basic Page': [
    {
      name: 'src/index.html',
      content: `<head>
  <link rel="stylesheet" type="text/css" href="./style.css">
</head>
<body>
  <a href="./other.html">Link</a>
  <script src="./index.js"></script>
</body>`,
      isEntry: true,
    },
    {
      name: 'src/index.js',
      content: `function func(){
 return "Hello World!";
}
document.body.append(document.createTextNode(func()))`,
    },
    {
      name: 'src/style.css',
      content: `body {\n  color: red;\n}`,
    },
    {
      name: 'src/other.html',
      content: 'This is a different page',
    },
    {
      name: '.htmlnanorc',
      content: `{\n  minifySvg: false\n}`,
    },
    {
      name: 'cssnano.config.js',
      content: `module.exports = {\n  preset: [\n    'default',\n    {\n      svgo: false\n    }\n  ]\n}`,
    },
  ],
  JSON: [
    {
      name: 'src/index.js',
      content: "import x from './test.json';\nconsole.log(x);",
      isEntry: true,
    },
    {name: 'src/test.json', content: '{a: 2, b: 3}'},
  ],
  'Symbol Propagation': [
    {
      name: 'src/index.js',
      content: "import {a} from './lib.js';\nconsole.log(a);",
      isEntry: true,
    },
    {
      name: 'src/lib.js',
      content: 'export * from "./lib1.js";\nexport * from "./lib2.js";',
    },
    {
      name: 'src/lib1.js',
      content: 'console.log("Hello 1");\n\nexport const a = 1;',
    },
    {
      name: 'src/lib2.js',
      content: 'console.log("Hello 2");\n\nexport const b = 2;',
    },
    {
      name: 'src/package.json',
      content: JSON.stringify({sideEffects: ['index.js']}, null, 2),
    },
  ],
  'Dynamic Import': [
    {
      name: 'src/index.js',
      content: `import("./async.js").then(({a}) => console.log(a))`,
      isEntry: true,
    },
    {
      name: 'src/async.js',
      content: 'export const a = 1;\nexport const b = 2;',
    },
  ],
  Envfile: [
    {
      name: 'src/index.js',
      content: 'console.log(process.env.SOMETHING);',
      isEntry: true,
    },
    {name: '.env', content: 'SOMETHING=124'},
  ],
  Typescript: [
    {
      name: 'src/index.ts',
      content: `function greeter(person: string) {
    return "Hello, " + person;
}

let user = "Jane User";

document.body.innerHTML = greeter(user);`,
      isEntry: true,
    },
  ],
  parcelrc: [
    {
      name: 'src/index.js',
      content: `const x = 1;\nconsole.log(x);`,
      isEntry: true,
    },
    {
      name: '.parcelrc',
      content: JSON.stringify(
        {
          extends: '@parcel/config-repl',
          optimizers: {
            '*.js': [],
          },
        },
        null,
        2,
      ),
    },
  ],
  //   Markdown: [
  //     {
  //       name: 'src/Article.md',
  //       content: '# My Title\n\nHello, ...\n\n```js\nconsole.log("test");\n```\n',
  //       isEntry: true,
  //     },
  //     {
  //       name: '.htmlnanorc',
  //       content: `{\n  minifySvg: false\n}`,
  //     },
  //   ],
  //   SCSS: [
  //     {
  //       name: 'src/style.scss',
  //       content: `$colorRed: red;
  // #header {
  //   margin: 0;
  //   border: 1px solid $colorRed;
  //   p {
  //     color: $colorRed;
  //     font: {
  //       size: 12px;
  //       weight: bold;
  //     }
  //   }
  //   a {
  //     text-decoration: none;
  //   }
  // }`,
  //       isEntry: true,
  //     },
  //     {
  //       name: 'cssnano.config.js',
  //       content: `module.exports = {\n  preset: [\n    'default',\n    {\n      svgo: false\n    }\n  ]\n}`,
  //     },
  //   ],
  //   LESS: [
  //     {
  //       name: 'src/style.less',
  //       content: `@some-color: #143352;

  // #header {
  //   background-color: @some-color;
  // }
  // h2 {
  //   color: @some-color;
  // }`,
  //       isEntry: true,
  //     },
  //     {
  //       name: 'cssnano.config.js',
  //       content: `module.exports = {\n  preset: [\n    'default',\n    {\n      svgo: false\n    }\n  ]\n}`,
  //     },
  //   ],
};
