// @flow
import path from 'path';
import nullthrows from 'nullthrows';
import type {REPLOptions} from './';

export type CodeMirrorDiagnostic = {|
  from: number,
  to: number,
  severity: 'info' | 'warning' | 'error',
  source: string,
  message: string,
  stack: ?string,
|};

export function join(a: string, ...b: Array<string>): string {
  return path.join(a || '/', ...b);
}

export type File = {|
  value: string,
  isEntry?: boolean,
|};
export type FSMap = Map<string, File | FSMap>;
export type FSList = Array<[string, File]>;

export class FS implements Iterable<[string, File | FSMap]> {
  /*:: @@iterator(): Iterator<[string, File | FSMap]> {
    // $FlowFixMe
    return {};
  } */

  files: FSMap;
  constructor(init: ?FSMap) {
    this.files = init ?? new Map();
  }

  has(path: string): boolean {
    return this.get(path) != null;
  }

  get(path: string): ?File {
    let parts = path.slice(1).split('/');
    let f = this.files;
    for (let p of parts) {
      // $FlowFixMe
      f = f?.get(p);
    }
    // $FlowFixMe
    return f;
  }

  list(files: FSMap = this.files, prefix: string = ''): Map<string, File> {
    let result = [];
    for (let [name, data] of files) {
      let p = join(prefix, name);
      if (data instanceof Map) {
        result.push(...this.list(data, p));
      } else {
        result.push([p, data]);
      }
    }
    return new Map(result);
  }

  move(from: string, to: string): FS {
    let data = nullthrows(this.get(from));
    return this.delete(from).set(to, data);
  }

  delete(path: string): FS {
    let parts = path.slice(1).split('/');
    // $FlowFixMe
    let result = new Map(this.files);

    let f = result;
    for (let p of parts.slice(0, -1)) {
      let copy = new Map(f.get(p) ?? []);
      f.set(p, copy);
      f = copy;
    }
    f.delete(parts[parts.length - 1]);
    return new FS(result);
  }

  set(path: string, value: FSMap | File): FS {
    let parts = path.slice(1).split('/');
    // $FlowFixMe
    let result = new Map(this.files);

    let f = result;
    for (let p of parts.slice(0, -1)) {
      // $FlowFixMe
      let copy = new Map(f.get(p) ?? []);
      f.set(p, copy);
      f = copy;
    }
    f.set(parts[parts.length - 1], value);
    return new FS(result);
  }

  setMerge(path: string, value: $Shape<File>): FS {
    let data = nullthrows(this.get(path));
    return this.set(path, {...data, ...value});
  }

  // $FlowFixMe
  [Symbol.iterator]() {
    return this.files[Symbol.iterator]();
  }

  toJSON(): Array<[string, File]> {
    return [...this.list()];
  }

  static fromJSON(obj: Object): FS {
    let fs = new FS();
    for (let [name, file] of obj) {
      fs = fs.set(name, file);
    }
    return fs;
  }
}

const HMR_OPTIONS: $Shape<REPLOptions> = {
  mode: 'development',
  hmr: true,
  scopeHoist: false,
  sourceMaps: true,
};

export const ASSET_PRESETS: Map<
  string,
  {|options?: $Shape<REPLOptions>, fs: FSMap|},
> = new Map([
  [
    'Javascript',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.js',
              {
                value: `import {Thing, x} from "./other.js";\nnew Thing().run();`,
                isEntry: true,
              },
            ],
            [
              'other.js',
              {
                value: `class Thing {\n  run() {\n    console.log("Test");\n  } \n}\n\nconst x = 123;\nexport {Thing, x};`,
              },
            ],
          ]),
        ],
      ]),
    },
  ],
  [
    'Flow',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.js',
              {
                value: `// @flow\nfunction foo(n: number): number {\n\treturn n * n;\n}\n\nfoo(2);`,
                isEntry: true,
              },
            ],
          ]),
        ],
        [
          'package.json',
          {
            value: `{\n  "devDependencies": {\n    "flow-bin": "*"\n  }\n}`,
            isEntry: true,
          },
        ],
      ]),
    },
  ],
  //   Babel: [
  //     {
  //       name: 'src/index.js',
  //       content: `class Point {
  //     constructor(x, y) {
  //         this.x = x;
  //         this.y = y;
  //     }
  //     toString() {
  //         return \`(\${this.x}, \${this.y})\`;
  //     }
  // }

  // console.log(new Point(1,2).toString());
  // `,
  //       isEntry: true,
  //     },
  //     {
  //       name: '.babelrc',
  //       content: `{ "presets": [["@babel/env", {"loose": true}]] }`,
  //     },
  //     // {
  //     //   name: 'src/package.json',
  //     //   content: `{\n "devDependencies": {\n  "@babel/core": "^7.3.4",\n  "@babel/preset-env": "^7.3.4"\n  }\n}`,
  //     // },
  //   ],
  [
    'Basic Page',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.html',
              {
                value: `<head>
  <link rel="stylesheet" type="text/css" href="./style.css">
</head>
<body>
  <a href="./other.html">Link</a>
  <script src="./index.js" type="module"></script>
</body>`,
                isEntry: true,
              },
            ],
            [
              'index.js',
              {
                value: `function func(){
  return "Hello World!";
}
document.body.append(document.createTextNode(func()))`,
              },
            ],
            [
              'style.css',
              {
                value: `body {\n  color: red;\n}`,
              },
            ],
            [
              'other.html',
              {
                value: 'This is a different page',
              },
            ],
          ]),
        ],
        // [
        //   '.htmlnanorc',
        //   {
        //     value: `{\n  minifySvg: false\n}`,
        //   },
        // ],
        // [
        //   'cssnano.config.js',
        //   {
        //     value: `module.exports = {\n  preset: [\n    'default',\n    {\n      svgo: false\n    }\n  ]\n}`,
        //   },
        // ],
      ]),
    },
  ],
  [
    'JSON',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.js',
              {
                value: "import x from './test.json';\nconsole.log(x);",
                isEntry: true,
              },
            ],
            ['test.json', {value: '{a: 2, b: 3}'}],
          ]),
        ],
      ]),
    },
  ],
  [
    'Symbol Propagation',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.js',
              {
                value: "import {a} from './lib.js';\nconsole.log(a);",
                isEntry: true,
              },
            ],
            [
              'lib.js',
              {value: 'export * from "./lib1.js";\nexport * from "./lib2.js";'},
            ],
            [
              'lib1.js',
              {value: 'console.log("Hello 1");\n\nexport const a = 1;'},
            ],
            [
              'lib2.js',
              {value: 'console.log("Hello 2");\n\nexport const b = 2;'},
            ],
            [
              'package.json',
              {value: JSON.stringify({sideEffects: ['index.js']}, null, 4)},
            ],
          ]),
        ],
      ]),
    },
  ],
  [
    'Dynamic Import',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.js',
              {
                value: `import("./async.js").then(({a}) => console.log(a))`,
                isEntry: true,
              },
            ],
            ['async.js', {value: 'export const a = 1;\nexport const b = 2;'}],
          ]),
        ],
      ]),
    },
  ],
  [
    'Envfile',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.js',
              {value: 'console.log(process.env.SOMETHING);', isEntry: true},
            ],
          ]),
        ],
        ['.env', {value: 'SOMETHING=124'}],
      ]),
    },
  ],
  [
    'Typescript',
    {
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.ts',
              {
                value: `function greeter(person: string) {
  return "Hello, " + person;
}

let user = "Jane User";

document.body.innerHTML = greeter(user);`,
                isEntry: true,
              },
            ],
          ]),
        ],
      ]),
    },
  ],
  //  .atlaspackrc: [
  //     {
  //       name: 'src/index.js',
  //       content: `const x = 1;\nconsole.log(x);`,
  //       isEntry: true,
  //     },
  //     {
  //       name: '.atlaspackrc',
  //       content: JSON.stringify(
  //         {
  //           extends: '@atlaspack/config-repl',
  //           optimizers: {
  //             '*.js': [],
  //           },
  //         },
  //         null,
  //         4,
  //       ),
  //     },
  //   ],
  [
    'HMR',
    {
      options: HMR_OPTIONS,
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.html',
              {
                isEntry: true,
                value: `<!DOCTYPE html>
<main></main>
<button>Update</button>
<script src="./index.js" type="module"></script>`,
              },
            ],
            [
              'index.js',
              {
                value: `let counter = 0;

if (module.hot) {
  module.hot.dispose(function (data) {
    data.counter = counter;
  });

  module.hot.accept(function () {
    counter = module.hot.data.counter;
    render();
  });
}

let btn = document.querySelector("button");
btn.onclick = (e) => {
  counter++;
  render();
}
function render(){
  btn.innerText = \`Update (\${counter})\`;
}
`,
              },
            ],
          ]),
        ],
      ]),
    },
  ],

  [
    'React (Fast Refresh)',
    {
      options: HMR_OPTIONS,
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.html',
              {
                isEntry: true,
                value: `<!DOCTYPE html>
<main></main>
<script src="./index.jsx" type="module"></script>`,
              },
            ],
            [
              'index.jsx',
              {
                value: `import * as React from "react";
import { createRoot } from 'react-dom/client';
import {App} from './App.jsx';
let root = createRoot(document.querySelector("main"));
root.render(<App />);`,
              },
            ],
            [
              'App.jsx',
              {
                value: `import * as React from "react";

export function App() {
  let [counter, setCounter] = React.useState(0);
  if (counter === 10) throw new Error("Too high!");
  return (
    <div>
      <div>Change me!</div>
      <button onClick={() => setCounter(counter + 1)}>Increment {counter}</button>
    </div>
  );
}`,
              },
            ],
          ]),
        ],
        [
          'package.json',
          {
            value: JSON.stringify(
              {
                name: 'repl',
                version: '0.0.0',
                engines: {
                  browsers: 'since 2019',
                },
                targets: {
                  app: {},
                },
                dependencies: {
                  react: '*',
                  'react-dom': '*',
                  'react-refresh': '^0.9.0',
                },
              },
              null,
              4,
            ),
          },
        ],
      ]),
    },
  ],

  [
    'React Spectrum',
    {
      options: HMR_OPTIONS,
      fs: new Map([
        [
          'src',
          new Map([
            [
              'index.html',
              {
                isEntry: true,
                value: `<!DOCTYPE html>
<main></main>
<script src="./index.jsx" type="module"></script>`,
              },
            ],
            [
              'index.jsx',
              {
                value: `import * as React from "react";
import { createRoot } from 'react-dom/client';
import {App} from './App.jsx';
let root = createRoot(document.querySelector("main"));
root.render(<App />);`,
              },
            ],
            [
              'App.jsx',
              {
                value: `import * as React from "react";
import {
  Provider,
  Form,
  TextField,
  ActionButton,
  AlertDialog,
  DialogTrigger,
  defaultTheme
} from "@adobe/react-spectrum";
export function App() {
  let [name, setName] = React.useState("");
  let [email, setEmail] = React.useState("");
  return (
    <Provider theme={defaultTheme}>
      <Form maxWidth="size-3600">
        <TextField
          label="Name"
          placeholder="John Doe"
          value={name}
          onChange={setName}
        />
        <TextField
          label="Email"
          placeholder="abc@gmail.com"
          value={email}
          onChange={setEmail}
        />
        <DialogTrigger>
          <ActionButton disabled={!name || !email}>Save</ActionButton>
          <AlertDialog
            variant="confirmation"
            title="Are you sure?"
            primaryActionLabel="Yes"
            cancelLabel="Cancel"
          >
            Hello {name}, is this really your email address: {email}?
          </AlertDialog>
        </DialogTrigger>
      </Form>
    </Provider>
  );
}
          `,
              },
            ],
          ]),
        ],
        [
          'package.json',
          {
            value: JSON.stringify(
              {
                name: 'repl',
                version: '0.0.0',
                engines: {
                  browsers: 'since 2019',
                },
                targets: {
                  app: {},
                },
                dependencies: {
                  '@adobe/react-spectrum': '*',
                  react: '*',
                  'react-dom': '*',
                  'react-refresh': '^0.9.0',
                },
              },
              null,
              4,
            ),
          },
        ],
      ]),
    },
  ],
  ['Three.js Benchmark', {fs: new Map()}],
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
  // };
]);
