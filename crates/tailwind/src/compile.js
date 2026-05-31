const path = require('path')
const fs = require('fs')

exports.compileTailwind = async function compileTailwind(resolve, from, base, css, candidates) {
  const tailwindcssPath = resolve('tailwindcss', from, 0)
  const { compile } = require(tailwindcssPath)

  const compiler = await compile(css, {
    from,
    base,
    shouldRewriteUrls: true,
    loadModule(id, base) {
      const resolved = resolve(id, base, 0)
      return require(resolved)
    },
    loadStylesheet(id, base) {
      const resolved = resolve(id, base, 1)
      return {
        path: resolved,
        base: path.dirname(resolved),
        content: fs.readFileSync(resolved, 'utf8'),
      }
    },
  })

  return compiler.build(candidates)
}
