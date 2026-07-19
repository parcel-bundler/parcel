import {createHash} from 'crypto';

let hash = createHash('md5');
hash.update('testing');
export default hash.digest('hex');
