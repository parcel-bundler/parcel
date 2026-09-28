sideEffect('c');
Promise.resolve().then(() => sideEffect('c microtask'));
