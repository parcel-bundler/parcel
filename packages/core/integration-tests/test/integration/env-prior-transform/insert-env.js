module.exports = function insertEnv(babel) {
  const exportFoo = babel.template('module.exports = process.env.NODE_ENV;', {syntacticPlaceholders: true});

  return {
    visitor: {
      Program(path) {
        path.node.body.push(exportFoo());
      }
    }
  }
}
