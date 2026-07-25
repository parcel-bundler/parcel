import * as namespace from './barrel.js';
import {update} from './barrel.js';

let before = namespace.value;
update('after');
output = [before, namespace.value];
