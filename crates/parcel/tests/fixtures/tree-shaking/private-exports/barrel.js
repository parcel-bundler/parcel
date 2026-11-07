// Its private names collide with those of the modules it copies through `export *`.
export const barrelExportName = 'barrel';
export {privateExportName as renamedExport, default as defaultReexport} from './lib.js';
export {PrivateExportClass} from './lib.js';
export * from './star.js';
export * from './star-collision.js';
