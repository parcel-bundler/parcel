const fs = require('fs');
const path = require('path');

self.postMessage(fs.readFileSync(path.join(__dirname, 'test.txt'), 'utf8'));
