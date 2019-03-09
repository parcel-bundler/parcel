import {h} from 'preact';

export function ParcelError(props) {
  let {highlightedCodeFrame, loc, fileName, message} = props.children;
  window.thing = props.children;

  fileName = fileName
    ? unfixPath(fileName) + (loc ? `:${loc.line}:${loc.column}:` : ':')
    : '';
  highlightedCodeFrame = highlightedCodeFrame || '';
  return (
    <div class="file error">
      {`${fileName} ${message}\n${highlightedCodeFrame}`.trim()}
    </div>
  );
}

export function fixPath(f) {
  return '/mem/' + f;
}

export function unfixPath(f) {
  return f.replace(/^\/mem\//, '');
}

export const presetDefault = [
  {
    name: 'index.js',
    content: `import {a, x} from "./other.js";\nconsole.log(x);`,
    isEntry: true
  },
  {
    name: 'other.js',
    content: `function a(){return "asd";}\nconst x = 123;\nexport {a, x};`
  }
];

export const presetJSON = [
  {
    name: 'index.js',
    content: "import x from './test.json';\nconsole.log(x);",
    isEntry: true
  },
  {name: 'test.json', content: '{a: 2, b: 3}'}
];
