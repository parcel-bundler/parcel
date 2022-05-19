import * as crypto from 'node:crypto';

function createHash() {
    const hash = crypto.createHash('sha256');
    hash.update('some data to hash');
    return hash.digest('hex')
}

export default createHash();
