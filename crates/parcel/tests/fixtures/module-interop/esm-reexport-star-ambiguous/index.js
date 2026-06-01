import * as ns from './middle.js';
// When two star-reexports define the same name, both modules are included;
// the result is implementation-defined (spec says ambiguous = undefined, many bundlers pick one)
output = typeof ns.name === 'string' ? 'resolved' : 'ambiguous';
