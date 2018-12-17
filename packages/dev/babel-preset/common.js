const flow = require('@babel/preset-flow');

module.exports = {
  presets: [flow],
  plugins: [require('@babel/plugin-proposal-class-properties')]
};
