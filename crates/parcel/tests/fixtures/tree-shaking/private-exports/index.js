import privateDefaultExport, {privateExportName} from './lib.js';
import * as barrel from './barrel.js';
import {starExportName, collidingStarExportName} from './barrel.js';
import * as escaped from './escaped.js';
import {asyncExportName} from './async.js';
import * as publicBarrel from './public-barrel.js';
import {mappedExportName} from './mapped.js';
import * as reexport from './reexport.js';

output = [
  privateExportName,
  privateDefaultExport(),
  barrel.renamedExport,
  barrel.defaultReexport(),
  new barrel.PrivateExportClass().method(),
  starExportName,
  collidingStarExportName,
  barrel.barrelExportName,
  Object.keys(escaped).join(),
  asyncExportName,
  Object.entries(publicBarrel).sort().join(),
  mappedExportName,
  Object.values(reexport).join(),
];
