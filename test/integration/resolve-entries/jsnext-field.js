const required = require('./pkg-jsnext-module')

if(required.test() !== 'pkg-jsnext-module') {
    throw new Error('Invalid module')
}

export const test = required.test
