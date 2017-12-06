const isURL = require('is-url');

module.exports = function (url) {
  return isURL(url) || /^#/.test(url);
};
