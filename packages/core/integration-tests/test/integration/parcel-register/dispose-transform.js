let {dispose} = require('@parcel/register');
let indexPath = require.resolve('./index');
require('./index');
dispose();
delete require.cache[indexPath]
require('./index');
