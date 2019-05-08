process.browser = false
module.exports = function () {
  return process.browser && test(process.browser);
};

function test(val) {
  return val;
}
