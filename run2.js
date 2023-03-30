// @flow
/* eslint-disable import/no-extraneous-dependencies */
const {transform} = require('lightningcss');

let res = transform({
  filename: '/a.js',
  code: Buffer.from(`
@import 'other.css';
.foo {
  color: red;
  background: url(x.png);
}
`),
  analyzeDependencies: true,
});
console.log(
  require('util').inspect(
    {...res, code: res.code.toString()},
    {depth: Infinity},
  ),
);

// let {TraceMap, originalPositionFor} = require('@jridgewell/trace-mapping');
// let {default: SourceMap} = require('@parcel/source-map');
// let fs = require('fs');

// let contents = fs.readFileSync('./out.css.map', 'utf8');

// let tracer = new TraceMap(JSON.parse(contents));
// let map = new SourceMap('/');
// map.addVLQMap(JSON.parse(contents));

// // let parcelPos = {start: {line: 4, column: 17}, end: {line: 4, column: 22}};
// let parcelPos = {start: {line: 3, column: 19}, end: {line: 3, column: 23}};

// // Lines start at line 1, columns at column 0.
// let start = originalPositionFor(tracer, {
//   line: parcelPos.start.line,
//   column: parcelPos.start.column - 1,
// });
// let end = originalPositionFor(tracer, {
//   line: parcelPos.end.line,
//   column: parcelPos.end.column - 1,
// });
// console.log(parcelPos.start, start);
// console.log(parcelPos.end, end);

// // Lines start at line 1, columns at column 0.
// start = map.findClosestMapping(
//   parcelPos.start.line,
//   parcelPos.start.column - 1,
// );
// end = map.findClosestMapping(parcelPos.end.line, parcelPos.end.column - 1);
// console.log(parcelPos.start, start);
// console.log(parcelPos.end, end);
