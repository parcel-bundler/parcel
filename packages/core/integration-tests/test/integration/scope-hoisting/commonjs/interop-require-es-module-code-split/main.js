import sharedBundle from './shared';
const importBundle = import('./import');

export default importBundle.then(importValue => importValue.default + ':' + sharedBundle.foo);
