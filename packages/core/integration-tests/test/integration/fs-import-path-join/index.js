import fs from 'fs';
import path from 'path';
module.exports = fs.readFileSync(path.join(__dirname, '/test.txt'), 'utf8');
