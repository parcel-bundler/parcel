// TypeScript's esModuleInterop flag generates code like this when compiling dynamic import()
"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
module.exports = Promise.resolve().then(function () { return __importStar(require('./async')); });
