const fs = require('fs');
const path = require('path');

const typesPath = path.join(__dirname, '../lib/index.d.ts');

let contents = fs.readFileSync(typesPath, 'utf8');
// Some fixups of flow-to-ts output
contents = contents.replace(
  'Record<string, JSONValue>',
  '{[key: string]: JSONValue}',
);
contents = contents.replace(/\$ReadOnlyMap/g, 'ReadonlyMap');
contents = contents.replace(/\$ReadOnlySet/g, 'ReadonlySet');
contents = contents.replace(/\$Partial/g, 'Partial');

fs.writeFileSync(typesPath, contents);
