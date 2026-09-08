exports.name = 'b';
exports.other = () => require('./a').name;
sideEffect('b');
