const common = require('./common');

module.exports = () => ({
  presets: [
    [
      require('@babel/preset-env'),
      {
        targets: {
          node: 6
        }
      }
    ],
    ...common.presets
  ]
});
