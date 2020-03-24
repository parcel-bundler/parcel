import mainValue from './main_child';
const importBundle = import('./import');

export default importBundle.then(importValue => importValue.default + ':' + mainValue);
