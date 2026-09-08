exports.name = 'a';
exports.other = () => require('./b').name;
sideEffect('entry');
globalThis.output = () => [exports.name, exports.other()];
