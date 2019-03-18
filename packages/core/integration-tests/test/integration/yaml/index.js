var local = require('./local.yaml');

module.exports = () => local.a + local.b.c;
