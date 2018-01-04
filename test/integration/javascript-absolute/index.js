const other = require('/other');
const another = require('~/another');

module.exports.test = function() {
    return other.a + another.b;
}