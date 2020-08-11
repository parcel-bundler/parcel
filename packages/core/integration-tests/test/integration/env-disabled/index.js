module.exports = function () {
  return process.env.FOOBAR + test(process.env.FOOBAR);
};

function test(str) {
  return ':' + str;
}
