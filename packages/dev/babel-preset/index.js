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
    require('@babel/plugin-proposal-class-properties'),
    require('@babel/plugin-proposal-nullish-coalescing-operator'),
    require('@babel/plugin-proposal-optional-chaining')
  ]
});
