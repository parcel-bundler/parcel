import {returnThis} from './other.mjs';
import * as ns from './other.mjs';

output = [returnThis(), ns.returnThis()];

// in dist: output[0] should be the babel 0 thing
