const isURL = require('is-url');

// Matches anchor (ie: #raptors)
const ANCHOR_REGEXP = /^#/;

// Matches scheme (ie: tel:, mailto:, data:)
const SCHEME_REGEXP = /^[a-z]*:/i;

module.exports = function(url) {
  return isURL(url) || ANCHOR_REGEXP.test(url) || SCHEME_REGEXP.test(url);
};
