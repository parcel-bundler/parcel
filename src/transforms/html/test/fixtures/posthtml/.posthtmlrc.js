module.exports = {
  plugins: [
    require('posthtml-include')({
      root: __dirname
    })
  ]
};
