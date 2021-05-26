import _, {add} from 'lodash';
import * as lodash from 'lodash';

let _add = 'add';
export const bar = _.add(add(1, 2), lodash[_add](1, 2));
