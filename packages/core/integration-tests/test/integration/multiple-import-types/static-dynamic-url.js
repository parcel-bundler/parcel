import Foo from './other';

export {Foo};
export const LazyFoo = import('./other.js').then(({default: LazyFoo}) => LazyFoo);
export const url = new URL('./other.js', import.meta.url).toString();
