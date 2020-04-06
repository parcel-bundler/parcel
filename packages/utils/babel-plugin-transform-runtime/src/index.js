const semver = require('semver');
const pluginTransformRuntime = require('@babel/plugin-transform-runtime')
  .default;

const COMPATIBLE_PARCEL_BABEL_TRANSFORMER_SEMVER = '^2.0.0-alpha.1.1';

module.exports = function parcelPluginTransformRuntime(api, opts, dirname) {
  let name = api.caller(caller => caller && caller.name);
  let version = api.caller(caller => caller && caller.version);

  if (
    name === 'parcel' &&
    typeof version === 'string' &&
    semver.satisfies(version, COMPATIBLE_PARCEL_BABEL_TRANSFORMER_SEMVER)
  ) {
    let targets = api.caller(caller => {
      return caller && caller.targets;
    });
    let outputFormat = api.caller(caller => {
      return caller && caller.env;
    });
    if (typeof targets !== 'string') {
      throw new Error('Expected targets to be a string');
    }

    return pluginTransformRuntime(
      api,
      {useESModules: outputFormat === 'esmodule', ...opts},
      dirname,
    );
  }

  return pluginTransformRuntime(api, opts, dirname);
};
