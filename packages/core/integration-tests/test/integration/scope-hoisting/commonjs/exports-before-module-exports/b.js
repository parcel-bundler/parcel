// Assign to both `exports` and `module.exports` in CommonJS.
// Some published packages do this in babel-generated output:
// https://unpkg.com/browse/dom-helpers@3.4.0/class/hasClass.js

exports.foo = 27;
module.exports = 42;
