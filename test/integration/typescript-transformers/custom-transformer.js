const ts = require('typescript')

module.exports =
  () => ({
    before: [
      context =>
        source =>
          ts.visitNode(source, function visit(node) {
            if(ts.isStringLiteral(node)) {
              return ts.createLiteral(node.text.replace(/failed/, 'passed'))
            }

            return ts.visitEachChild(node, visit, context)
          }
        )
    ]
  })
