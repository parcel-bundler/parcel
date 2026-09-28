import './b.js';
sideEffect('d');
Promise.resolve().then(() => sideEffect('d microtask'));
