import {h} from 'preact';

export function ParcelError(props) {
  let {highlightedCodeFrame, loc, fileName, message, stack} = props.children;
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
  ]
};
