import {value} from './barrel.js';

output = async () => [value, (await import('./barrel.js')).value];
