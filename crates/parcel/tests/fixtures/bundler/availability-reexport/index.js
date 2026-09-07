import {value} from './barrel';
output = () => import('./lazy').then(m => m.value + value);
