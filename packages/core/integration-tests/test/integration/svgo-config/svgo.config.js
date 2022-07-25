const { extendDefaultPlugins } = require('svgo');

module.exports = {
  plugins: extendDefaultPlugins([
    {
      name: 'removeComments',
      active: false
    }
  ])
}
