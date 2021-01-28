module.exports.other = () => 'other';

module.exports.run = () => `Say ${exports.other()}`;
