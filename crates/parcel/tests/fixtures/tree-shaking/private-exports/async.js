import {privateExportName} from './lib.js';
export const asyncExportName = await Promise.resolve(privateExportName + '-async');
