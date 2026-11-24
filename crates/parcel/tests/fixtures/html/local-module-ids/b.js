import {shared} from './shared.js';
sideEffect('b:' + shared());
import('./lazy.js').then(lazy => sideEffect('b:' + lazy.value));
