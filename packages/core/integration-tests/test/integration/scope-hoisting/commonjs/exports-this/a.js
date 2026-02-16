exports.foo = function() {
    return exports.bar()
}

exports.bar = function() {
    return this.baz()
}

exports.baz = function() {
    return 2
}