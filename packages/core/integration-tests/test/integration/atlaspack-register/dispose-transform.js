let {dispose} = require('@atlaspack/register');
let indexPath = require.resolve('./index');
require('./index');
dispose();
delete require.cache[indexPath]
require('./index');
