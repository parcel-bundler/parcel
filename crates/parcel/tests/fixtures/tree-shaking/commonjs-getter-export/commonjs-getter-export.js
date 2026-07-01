const dep = require('./dep-commonjs-getter-export.js');

sideEffect(dep.usedGetterExport);
sideEffect(dep.unusedGetterExport);
