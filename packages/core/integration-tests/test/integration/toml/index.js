var local = require('./local.toml');

module.exports = () => local.a + local.b.c;
