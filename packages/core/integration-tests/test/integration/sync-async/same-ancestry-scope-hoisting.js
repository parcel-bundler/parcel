import dep from './dep';

output = import('./get-dep')
  .then(mod => mod.default)
  .then(asyncDep => [dep, asyncDep]);
