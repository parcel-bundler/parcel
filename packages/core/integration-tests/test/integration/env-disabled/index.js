const external = require("foo");

module.exports = function () {
  return process.env.FOOBAR + test(process.env.FOOBAR) + test(external);
};

function test(str) {
  return ':' + str;
}
