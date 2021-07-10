import t from 'bundle-text:./other';

export const lazy = import('./other').then(({default: LazyFoo}) => LazyFoo);
export const text = t;
