const required = require('./pkg-both')

if(required.test() !== 'pkg-es6-module') {
    throw new Error('Invalid module')
}

export const test = required.test
