const fs = require('fs');

fs.symlinkSync('../native-packages', 'packages/native-packages', 'junction');
