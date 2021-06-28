const fs = require('fs');

let contents = fs.readFileSync(__dirname + '/lib/index.d.ts', 'utf8');

// Some fixups of flow-to-ts output
contents = contents.replace(
  'Record<string, JSONValue>',
  '{[key: string]: JSONValue}',
);
contents = contents.replaceAll('$ReadOnlyMap', 'ReadonlyMap');
contents = contents.replaceAll('$ReadOnlySet', 'ReadonlySet');

fs.writeFileSync(__dirname + '/lib/index.d.ts', contents);
