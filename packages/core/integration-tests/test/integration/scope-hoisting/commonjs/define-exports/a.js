export const foo = 'bar'

export function getExports() {
    return exports
}

output = getExports() === exports && getExports().foo
