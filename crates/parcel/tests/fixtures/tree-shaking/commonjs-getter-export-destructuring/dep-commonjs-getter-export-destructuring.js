exports.usedGetterExport = 'used-commonjs-getter-destructuring';

Object.defineProperty(exports, 'readGetterExport', {
  enumerable: true,
  get() {
    sideEffect('commonjs-destructured-getter-read');
    return 'commonjs-destructured-getter-value';
  }
});

Object.defineProperty(exports, 'unusedGetterExport', {
  enumerable: true,
  get() {
    sideEffect('commonjs-destructured-unused-getter-sentinel');
    return 'unused';
  }
});
