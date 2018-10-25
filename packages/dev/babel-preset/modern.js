const common = require('./common');

module.exports = () => ({
  presets: [
    [
      require('@babel/preset-env'),
      {
        targets: {
          node: 8
        }
      }
    ],
    ...common.presets
  ]
});
