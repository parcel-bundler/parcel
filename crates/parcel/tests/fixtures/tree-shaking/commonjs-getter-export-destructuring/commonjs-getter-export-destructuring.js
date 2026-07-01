const {
  usedGetterExport,
  readGetterExport
} = require('./dep-commonjs-getter-export-destructuring.js');

sideEffect(usedGetterExport);
sideEffect(readGetterExport);
