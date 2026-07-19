var vars = require('./dir/**/*.js?flat=true');

module.exports = function () {
  return (
    vars['./dir/a.js'] +
    vars['./dir/b.js'] +
    vars['./dir/x/c.js'] +
    vars['./dir/x/y/z.js']
  );
};
