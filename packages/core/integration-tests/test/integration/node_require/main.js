var {a} = require('testmodule');
var {b} = require('./local');

module.exports = () => a + b;
