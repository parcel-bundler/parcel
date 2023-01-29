export const lazy = import('./other.js').then(({default: LazyFoo}) => LazyFoo);
export const url = new URL('./other.js', import.meta.url).toString();
