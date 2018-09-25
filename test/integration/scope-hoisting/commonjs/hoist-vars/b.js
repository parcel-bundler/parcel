if(process.env.NODE_ENV === 'test') {
    var c = require('./c')()

    for(var i = 0, {length} = c, out = ''; i < length; i++) {
        out += c[i]
    }

    module.exports = function() {
        if(c != out) throw new Error()

        return out
    }
}
