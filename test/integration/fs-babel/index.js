import fs from 'fs';
const name = fs.readFileSync(__dirname + '/test.txt', 'utf8');
module.exports = name;
