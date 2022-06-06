import {B} from './b.js';
import {C} from './c.js';

output = [new B()[Symbol.toStringTag], new C()[Symbol.toStringTag]];
