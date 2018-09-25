/**
 * Generates a babel config for stripping away Flow types.
 */
function getFlowConfig(asset) {
  if (/^(\/{2}|\/\*+) *@flow/.test(asset.contents.substring(0, 20))) {
    return {
      internal: true,
      babelVersion: 7,
      config: {
        plugins: [[require('@babel/plugin-transform-flow-strip-types')]]
      }
    };
  }

  return null;
}

module.exports = getFlowConfig;
