import mainValue from './main_child';
const importBundle = import('./import');

output = importBundle.then(importValue => importValue.default + ':' + mainValue);
