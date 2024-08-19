let {dispose} = require('@atlaspack/register');
console.log(require.resolve('~foo.js'));
dispose();
console.log(require.resolve('~foo.js'));
