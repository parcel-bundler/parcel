// Support both commonjs and ES6 modules
const hook = require('./hook');

exports = module.exports = hook.default;
exports.__esModule = true;
Object.assign(exports, hook);
