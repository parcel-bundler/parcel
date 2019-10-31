module.exports = function insertEnv(babel) {
  const importFoo = babel.template("import foo from './foo';");

  return {
    visitor: {
      Program(path) {
        path.node.body.unshift(importFoo());
      }
    }
  }
}
