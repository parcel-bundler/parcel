const required = require('./pkg-main')

if(required.test() !== 'pkg-main-module') {
    throw new Error('Invalid module')
}

export const test = required.test
