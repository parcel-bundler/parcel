const uglify = require('uglify-es');
const fs = require('./src/utils/fs');
const path = require('path');

async function minify(inputPath, outputPath) {
  let input = (await fs.readFile(inputPath)).toString();

  // Minify input
  let options = {
    mangle: {
      toplevel: true
    },
    output: {
      ecma: 3,
      semicolons: false
    }
  };
  let res = uglify.minify(input, options);

  // Write output
  await fs.mkdirp(path.dirname(outputPath));
  await fs.writeFile(outputPath, res.code);
}

async function runMinifier() {
  let files = ['prelude.js'];

  files.forEach(async file => {
    await minify(
      path.join('./src/builtins/', file),
      path.join('./minified/builtins/', file)
    );
    // eslint-disable-next-line no-console
    console.log('minified: ' + file);
    return;
  });
}

(async () => {
  await runMinifier();
})();
