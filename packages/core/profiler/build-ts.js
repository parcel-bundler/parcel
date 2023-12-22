const fs = require('fs');

let contents = fs.readFileSync(__dirname + '/lib/Tracer.d.ts', 'utf8');

// Some fixups of typescript output
contents = contents.replace(/^\s*#private;\s*$/gm, '');

fs.writeFileSync(__dirname + '/lib/Tracer.d.ts', contents);
