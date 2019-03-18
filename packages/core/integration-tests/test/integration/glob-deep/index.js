var vars = require('./dir/**/*.js');

module.exports = () => vars.a + vars.b + vars.x.c + vars.x.y.z;
