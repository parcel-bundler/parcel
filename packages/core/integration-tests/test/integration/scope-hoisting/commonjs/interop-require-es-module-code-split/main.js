import sharedBundle from './shared';
const importBundle = import('./import');

output = importBundle.then(importValue => importValue.default + ':' + sharedBundle.foo);
