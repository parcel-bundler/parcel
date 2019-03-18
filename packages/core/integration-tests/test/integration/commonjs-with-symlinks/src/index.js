var local = require('./symlinked_local');

module.exports = () => local.a + local.b;
