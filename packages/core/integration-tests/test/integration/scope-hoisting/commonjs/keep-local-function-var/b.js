var root = require('./c');

var freeModule = typeof module == 'object' && module && !module.nodeType && module;
module.exports = freeModule ? null : root;
