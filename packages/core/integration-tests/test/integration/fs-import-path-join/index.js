import fs from 'fs';
module.exports = fs.readFileSync(__dirname + '/test.txt', 'utf8');
