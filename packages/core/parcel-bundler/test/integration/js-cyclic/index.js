import {a, b as ab} from './a';
import {a as ba, b} from './b';

export default [a, b, ab.b, ba.a].join('');
