import Foo from './other';

export {Foo};
export const LazyFoo = import('./other').then(({default: LazyFoo}) => LazyFoo);
