try {
    output = require('noop')
}
catch(e) {
    output = [42, e.code]
}
