import {compute} from './c'

var b = import('./b');

export default b.then(function ({foo, bar}) {
  return compute(foo, 0) + compute(bar, 0);
});
