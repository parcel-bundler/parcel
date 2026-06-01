// Assign to exports first, then module.exports. module.exports wins.
// Common pattern in babel-generated output.
exports.foo = 27;
module.exports = 42;
