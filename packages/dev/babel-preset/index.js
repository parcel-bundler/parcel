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
    require('@babel/preset-react'),
    require('@babel/preset-flow')
  ],
  plugins: [
    require('./serializer'),
    require('@babel/plugin-proposal-class-properties')
  ]
});
