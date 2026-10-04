const postcssCustomProperties = require('postcss-custom-properties');

module.exports = {
  plugins: [
    postcssCustomProperties({
      importFrom: [
        {
          customProperties: {
            '--color': 'red'
          }
        }
      ]
    })
  ]
}
