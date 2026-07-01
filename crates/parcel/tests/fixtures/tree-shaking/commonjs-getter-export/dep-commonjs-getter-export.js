exports.usedGetterExport = 'used-commonjs-getter-export';

Object.defineProperty(exports, 'unusedGetterExport', {
  enumerable: true,
  get() {
    sideEffect('commonjs-getter-read');
    return 'unused-commonjs-getter-value';
  }
});

Object.defineProperty(exports, 'neverReadGetterExport', {
  enumerable: true,
  get() {
    sideEffect('commonjs-never-read-getter-sentinel');
    return 'never-read';
  }
});
