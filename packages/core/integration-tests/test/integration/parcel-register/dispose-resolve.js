let {dispose} = require('@parcel/register');
console.log(require.resolve('~foo.js'));
dispose();
console.log(require.resolve('~foo.js'));
