const localRequire = require('./localRequire');

module.exports = async function loadPlugins(
  plugins,
  relative,
  installPlugins = false
) {
  if (Array.isArray(plugins)) {
    return await Promise.all(
      plugins
        .map(
          async p =>
            await loadPlugin(p, relative, {
              install: installPlugins
            })
        )
        .filter(Boolean)
    );
  } else if (typeof plugins === 'object') {
    let mapPlugins = await Promise.all(
      Object.keys(plugins).map(
        async p =>
          await loadPlugin(p, relative, {
            install: installPlugins,
            pluginOptions: plugins[p]
          })
      )
    );
    return mapPlugins.filter(Boolean);
  } else {
    return [];
  }
};

async function loadPlugin(plugin, relative, options = {}) {
  if (typeof plugin === 'string') {
    if (typeof options !== 'object') {
      options = {};
    }

    plugin = await localRequire(plugin, relative, !options.install);
    plugin = plugin.default || plugin;

    if (Object.keys(options.pluginOptions).length > 0) {
      plugin = plugin(options.pluginOptions);
    }

    plugin = plugin.default || plugin;
  }

  return plugin;
}
