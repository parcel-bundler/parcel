const {upperCase} = require('lodash')

// name of this function is equal to package name - 'lodash'
function lodash(s) {
  return 'print-' + s
}
export const foo = lodash(upperCase('foo'))
