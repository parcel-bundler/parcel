import {T} from './i18n/index.js';

const version = import('./version.js');

export default version.then((v) => [T('index'), 'Diagram' + v.default()]);
