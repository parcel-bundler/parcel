const Bundle = require('./src/Bundle');
// const babel = require('babel-core');

process.on('unhandledRejection', console.error)

async function run() {
  let bundle = new Bundle('/Users/devongovett/projects/Storify/liveblog-editor/src/Editor.js');
  let module = await bundle.collectDependencies();
  printDeps(module);
}

function printDeps(module, indent = '', deps = new Set) {
  for (let [file, mod] of module.modules) {
    console.log(indent + file);
    if (!deps.has(mod.name)) {
      deps.add(mod.name);
      printDeps(mod, indent + '  ', deps);
      // babel.transformFromAst(mod.ast);
    }
  }
}

run().then(console.log, console.error);
