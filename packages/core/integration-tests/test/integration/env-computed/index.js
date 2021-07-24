let name = "ABC";
process.env[name] = "abc";
module.exports = process.env[name];
