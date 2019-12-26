const semver = require('semver');

const COMPATIBLE_PARCEL_BABEL_TRANSFORMER_SEMVER = '^2.0.0-alpha.1.1';

module.exports = function parcelBabelPresetEnv(api, opts) {
  let name = api.caller(caller => caller && caller.name);
  let version = api.caller(caller => caller && caller.version);

  if (
    name === 'parcel' &&
    typeof version === 'string' &&
    semver.satisfies(version, COMPATIBLE_PARCEL_BABEL_TRANSFORMER_SEMVER)
  ) {
    let targets = api.caller(caller => caller && caller.targets);
    if (typeof targets !== 'string') {
      throw new Error('Expected targets to be a string');
    }

    return {
      presets: [
        [
          '@babel/preset-env',
          {
            modules: false,
            targets: JSON.parse(targets),
            ...opts,
          },
        ],
      ],
    };
  }

  return {
    presets: [['@babel/preset-env', opts]],
  };
};
