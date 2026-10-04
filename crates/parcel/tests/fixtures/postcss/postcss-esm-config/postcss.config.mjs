import postcssCustomProperties from 'postcss-custom-properties';

export default {
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
