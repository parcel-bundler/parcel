// Dynamically import a module from a package with sideEffects: false.
// Even though the module has no side effects, the dynamic import
// should still be transformed because the user explicitly requested it.
var story = import('./node_modules/my-lib/story.js');

module.exports = function() {
  return story.then(function(m) { return m.default; });
};
