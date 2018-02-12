const required = require('./pkg-browser')

if(required.test() !== 'pkg-node') {
    throw new Error('Invalid module')
}

export const test = required.test
