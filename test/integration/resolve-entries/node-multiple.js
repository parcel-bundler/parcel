const required = require('./pkg-browser-multiple/projected')

if(required.test() !== 'pkg-node-multiple') {
    throw new Error('Invalid module')
}

export const test = required.test
