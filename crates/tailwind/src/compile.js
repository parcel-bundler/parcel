const path = require('path')
const fs = require('fs')

exports.compileTailwind = async function compileTailwind(resolve, from, base, css, getCandidates) {
  const tailwindcssPath = resolve('tailwindcss', from, 0)
  const { compile } = require(tailwindcssPath)

  const compiler = await compile(css, {
    from,
    base,
    shouldRewriteUrls: true,
    loadModule(id, base) {
      const resolved = resolve(id, from, 0)
      const module = require(resolved)
      return {
        path: resolved,
        base: path.dirname(resolved),
        module: module.default ?? module
      }
    },
    loadStylesheet(id, base) {
      const resolved = resolve(id, from, 1)
      return {
        path: resolved,
        base: path.dirname(resolved),
        content: fs.readFileSync(resolved, 'utf8'),
      }
    },
  })

  let sources = (() => {
    // Disable auto source detection
    if (compiler.root === 'none') {
      return []
    }

    // No root specified, use the base directory
    if (compiler.root === null) {
      return [{ base, pattern: '**/*', negated: false }]
    }

    // Use the specified root
    return [{ ...compiler.root, negated: false }]
  })().concat(compiler.sources || compiler.globs || []);

  return compiler.build(getCandidates(sources))
}
