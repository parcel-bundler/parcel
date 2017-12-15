const unsafeRegex = /[/*]/g;

module.exports = function sanitizePackageName(name, replacement = '-') {
  return name.replace(unsafeRegex, replacement);
};
