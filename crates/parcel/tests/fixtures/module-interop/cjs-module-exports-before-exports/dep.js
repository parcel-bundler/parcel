// module.exports assigned first, then exports.foo.
// exports still refers to the original object, but module.exports
// is now a number - the exports.foo mutation is disconnected.
module.exports = 42;
exports.foo = 27;
