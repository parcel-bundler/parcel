module.exports.other = function() { return 'other'; };
module.exports.run = function() { return 'Say ' + exports.other(); };
