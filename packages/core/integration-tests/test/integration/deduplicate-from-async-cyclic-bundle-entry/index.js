import bar from './bar';

export default [bar, import('./async').then(mod => mod.default)];
