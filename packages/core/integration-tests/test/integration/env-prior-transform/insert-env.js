module.exports = function insertEnv(babel) {
  const exportFoo = babel.template('module.exports = process.env.foo;');

  return {
    visitor: {
      Program(path) {
        path.node.body.push(exportFoo());
      }
    }
  }
}
