import './shared.js';
sideEffect('index');
const shared = await import('./shared.js');
sideEffect('shared ' + shared.value);
const lazy = await import('./lazy.js');
sideEffect('lazy ' + lazy.value);
