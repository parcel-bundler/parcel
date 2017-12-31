const required = require('./pkg-browser')

if(required.test() !== 'pkg-browser') {
    throw new Error('Invalid module')
}

export const test = required.test
