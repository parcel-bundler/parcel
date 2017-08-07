const Bundle = require('./src/Bundle');
const JSPackager = require('./src/packagers/JSPackager');
// const babel = require('babel-core');

process.on('unhandledRejection', console.error)

async function run() {
  let bundle = new Bundle('/Users/devongovett/projects/Storify/liveblog-editor/src/Editor.js');

  // bundle.package('*.css', new CSSPackager).pipe(fs.createWriteStream('out.js'));
  // bundle.package('*.')

  console.profile();

  let module = await bundle.collectDependencies();
  // printDeps(module);

  console.profileEnd();
  console.log('here')

  let packager = new JSPackager;
  packager.pipe(require('fs').createWriteStream('out.js'));
  packager.addAsset(module);
  packager.end();
}

function printDeps(module, indent = '', deps = new Set) {
  for (let [file, mod] of module.modules) {
    console.log(indent + file);
    if (!deps.has(mod.name)) {
      deps.add(mod.name);
      printDeps(mod, indent + '  ', deps);
    }
  }
}

run().then(console.log, console.error);
