import {ns, ns2} from './reexports';

export default import('./async').then(mod => [ns.foo, ns2.foo].concat(mod.default));
