import { val } from './dep.mjs';

export default import('./dep.mjs').then(m => [val, m.val]);
