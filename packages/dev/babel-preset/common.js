const flow = require('@babel/preset-flow');
const jsx = require('@babel/preset-react');
const serializerPlugin = require('./serializer');

module.exports = {
  presets: [jsx, flow],
  plugins: [
    serializerPlugin,
    require('@babel/plugin-proposal-class-properties')
  ]
};
