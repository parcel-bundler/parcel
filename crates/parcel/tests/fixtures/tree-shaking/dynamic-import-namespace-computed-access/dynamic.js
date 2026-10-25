let key = 'unused' + 'Dynamic';
output = import('./async-dep.js').then(mod => mod.usedDynamic + ' ' + mod[key]());
