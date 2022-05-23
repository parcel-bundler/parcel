const scoped = require('@scope/pkg/foo/*.js');
const unscoped = require('pkg/bar/*.js');

module.exports = function () {
    return scoped.a + scoped.b + unscoped.x + unscoped.y;
}