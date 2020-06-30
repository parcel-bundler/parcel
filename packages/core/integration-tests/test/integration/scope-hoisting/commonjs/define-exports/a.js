exports.foo = 'bar'

function getExports() {
    return exports
}

output = getExports() === exports && getExports().foo
