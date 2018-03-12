module.exports = function loadJSBundle(bundle) {
  return new Promise(function(resolve) {
    // require in the next event loop tick to let the main module load
    setTimeout(function() {
      require(__dirname + bundle)
      resolve()
    }, 0)
  });
};
