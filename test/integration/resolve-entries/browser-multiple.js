const required = require('./pkg-browser-multiple/projected')

if(required.test() !== 'pkg-browser-multiple') {
    throw new Error('Invalid module')
}

export const test = required.test
