const Bundler = require('./src/Bundler');
const JSPackager = require('./src/packagers/JSPackager');
// const babel = require('babel-core');

process.on('unhandledRejection', console.error)

async function run() {
  // let bundler = new Bundler('/Users/govett/dev/liveblog-editor/src/Editor.js');
  let bundler = new Bundler('/Users/govett/dev/engage-ui/src/index.js');

  // bundle.package('*.css', new CSSPackager).pipe(fs.createWriteStream('out.js'));
  // bundle.package('*.')

  console.profile();

  let main = await bundler.bundle();

  console.log(bundler.rootBundle);
  // printDeps(main);

  console.profileEnd();
  // console.log('here')

  // let packager = new JSPackager;
  // packager.pipe(require('fs').createWriteStream('out.js'));
  // packager.addAsset(main);
  // packager.end();
}

function printDeps(asset, indent = '', deps = new Set) {
  for (let [file, a] of asset.depAssets) {
    console.log(indent + file);
    if (!deps.has(a.name)) {
      deps.add(a.name);
      printDeps(a, indent + '  ', deps);
    }
  }
}

run().then(console.log, console.error);
