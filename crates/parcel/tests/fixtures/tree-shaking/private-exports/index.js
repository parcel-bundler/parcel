import privateDefaultExport, {privateExportName} from './lib.js';
import * as barrel from './barrel.js';
import {starExportName} from './barrel.js';
import * as escaped from './escaped.js';
import {asyncExportName} from './async.js';

output = [
  privateExportName,
  privateDefaultExport(),
  barrel.renamedExport,
  barrel.defaultReexport(),
  new barrel.PrivateExportClass().method(),
  starExportName,
  Object.keys(escaped).join(),
  asyncExportName,
];
