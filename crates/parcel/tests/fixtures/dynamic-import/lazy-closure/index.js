output = Promise.all([import('./b'), import('./c')]).then(() => import('./a')).then(m => m.default);
