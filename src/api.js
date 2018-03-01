const Plugins = require('./Plugins');

module.exports = async function(main, options = {}) {
  // Load plugins
  await Plugins.init(main);

  // Bundler Instance
  const Bundler = require('./Bundler');
  return new Bundler(main, options);
};
