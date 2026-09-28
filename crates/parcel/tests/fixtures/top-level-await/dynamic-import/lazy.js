import {value as shared} from './shared.js';
import './lazy-dep.js';
sideEffect('lazy');
export const value = shared + (await Promise.resolve('l'));
