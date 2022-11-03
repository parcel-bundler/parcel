const required = require('./pkg-es6-module')

if(required.test() !== 'pkg-es6-module') {
    throw new Error('Invalid module')
}

export const test = required.test
