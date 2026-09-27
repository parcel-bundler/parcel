output = Promise.all([import('./a'), import('./b')]).then(([a, b]) => a.default + b.default);
