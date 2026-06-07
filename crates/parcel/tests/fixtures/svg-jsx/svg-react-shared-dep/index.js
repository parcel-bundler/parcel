const Icon = require('./icon.svg');
const react = require('react');

// Both the direct import and the SVG-compiled-to-JSX import react.
// They should share the same react module (no duplicate copies).
module.exports = function() {
  return typeof react.createElement;
};
