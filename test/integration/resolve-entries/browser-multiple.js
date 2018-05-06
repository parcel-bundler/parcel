const projected = require('./pkg-browser-multiple/projected')

if(projected.test() !== 'pkg-browser-multiple') {
    throw new Error('Invalid module')
}

const entry = require('./pkg-browser-multiple')

if(entry.test() !== 'pkg-browser-multiple browser-entry') {
    throw new Error('Invalid module')
}

export const test = {projected, entry}
