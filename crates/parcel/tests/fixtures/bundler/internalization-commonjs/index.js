import value from './value';
export default () => import('./value').then(m => [value, m.default]);
