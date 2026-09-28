import {value, later} from './value.js';
sideEffect(value);
export default await Promise.resolve(value + later);
