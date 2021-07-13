export const lazy = import('./other').then(({default: LazyFoo}) => LazyFoo);
export const url = new URL('./other', import.meta.url).toString();
