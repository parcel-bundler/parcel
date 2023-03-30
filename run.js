/* eslint-disable import/no-extraneous-dependencies */
const fs = require('fs');
// const babel = require('@babel/core');

// const code = `// @flow

// type Test = {|
//   foo: string
// |};

// let test: Test = {
//   foo: 'hi'
// };

// import foo from 'foo';

// console.log(test);
// `;

// babel.transform(
//   code,
//   {
//     plugins: ['@babel/plugin-transform-flow-strip-types'],
//     sourceMap: true,
//     babelrc: false,
//     configFile: false,
//   },
//   function (err, {code, map}) {
//     fs.writeFileSync('out.js', code);
//     fs.writeFileSync('out.js.map', JSON.stringify(map, null, 2));
//   },
// );

const sass = require('sass');

const code = `$foo: red;

.foo {
  color: $foo;
  background: url(x.png);
}`;

sass.render(
  {
    sourceMap: true,
    omitSourceMapUrl: true,
    outFile: '/out.js',
    sourceMapContents: true,
    file: '/x.js',
    data: code,
  },
  (err, {css, map}) => {
    console.log(map);
    fs.writeFileSync('out.css', css);
    fs.writeFileSync('out.css.map', map);
  },
);
