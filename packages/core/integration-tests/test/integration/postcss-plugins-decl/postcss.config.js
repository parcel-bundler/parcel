module.exports = {
  "plugins": [
    {
      postcssPlugin: 'PLUGIN NAME',
      Rule: (rule, { Declaration }) => {
        const decl = new Declaration({ prop: 'background-image', value: 'url("data:image/gif;base64,quotes")' })
        rule.append(decl)
      },
    }
  ]
}
