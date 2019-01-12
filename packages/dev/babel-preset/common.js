const flow = require('@babel/preset-flow');
const serializerPlugin = require('./serializer');

module.exports = {
  presets: [flow],
  plugins: [serializerPlugin, require('@babel/plugin-proposal-class-properties')]
};
