exports.name = 'a';
exports.other = () => require('./b').name;
sideEffect('a');
