exports.name = 'b';
exports.other = () => require('./a').name;
sideEffect('entry');
globalThis.output = () => [exports.other(), exports.name];
