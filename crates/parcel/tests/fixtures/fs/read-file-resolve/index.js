var fs = require('fs');
module.exports = fs.readFileSync(require.resolve('./test.txt'), 'utf8');
