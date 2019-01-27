const path = require('path');

module.exports = function(name) {
  let parts = path.normalize(name).split(path.sep);
  if (parts[0].charAt(0) === '@') {
    // Scoped module (e.g. @scope/module). Merge the first two parts back together.
    parts.splice(0, 2, `${parts[0]}/${parts[1]}`);
  }

  return parts;
};
