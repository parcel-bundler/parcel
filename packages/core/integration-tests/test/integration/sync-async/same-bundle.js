import dep from './dep';
import getDep from './get-dep';
// Test multiple async dependencies to `dep` in the same bundle
import getDep2 from './get-dep-2';

export default Promise.all([
  getDep,
  getDep2,
]).then(([_async, _async2]) => [dep, _async, _async2]);
