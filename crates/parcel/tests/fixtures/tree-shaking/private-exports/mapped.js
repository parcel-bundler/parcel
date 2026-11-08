export const mappedExportName = 'mapped';
// Not copied by `export *`, so a hole in the names it maps.
export default 'not re-exported';
export const otherMappedExportName = 'other';
const comma = 'comma';
export {comma as 'with,comma'};
