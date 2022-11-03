import dep from './dep';

export default import('./get-dep')
  .then(mod => mod.default)
  .then(asyncDep => [dep, asyncDep]);
