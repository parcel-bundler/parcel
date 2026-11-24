import {shared} from './shared.js';
import {helper} from './helper.js';
sideEffect('a:' + shared() + ':' + helper());
import('./lazy.js').then(lazy => sideEffect('a:' + lazy.value));
