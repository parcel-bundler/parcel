exports.foo = function() {
    exports.bar()
}

exports.bar = function() {
    this.baz()
}

exports.baz = function() {
    return 2
}