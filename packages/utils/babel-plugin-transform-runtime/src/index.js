const semver = require('semver');
const pluginTransformRuntime =
  require('@babel/plugin-transform-runtime').default;

const COMPATIBLE_ATLASPACK_BABEL_TRANSFORMER_SEMVER = '^2.0.0-alpha.1.1';

module.exports = function atlaspackPluginTransformRuntime(api, opts, dirname) {
  let name = api.caller(caller => caller && caller.name);
  let version = api.caller(caller => caller && caller.version);

  if (
    name === 'atlaspack' &&
    typeof version === 'string' &&
    semver.satisfies(version, COMPATIBLE_ATLASPACK_BABEL_TRANSFORMER_SEMVER)
  ) {
    let outputFormat = api.caller(caller => {
      return caller && caller.outputFormat;
    });
    if (typeof outputFormat !== 'string' && outputFormat !== undefined) {
      throw new Error('Expected outputFormat to be a string');
    }

    return pluginTransformRuntime(
      api,
      {...opts, useESModules: outputFormat === 'esmodule'},
      dirname,
    );
  }

  return pluginTransformRuntime(api, opts, dirname);
};
