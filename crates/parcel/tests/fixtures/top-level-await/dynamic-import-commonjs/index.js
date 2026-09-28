import './async.js';
import promise from './cjs.cjs';
sideEffect('index');
sideEffect(await promise);
