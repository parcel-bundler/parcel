import fs from 'fs';
export default fs.readFileSync(__dirname + '/test.txt', 'utf8');
