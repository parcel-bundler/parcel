process.browser = false
module.exports = () => process.browser && test(process.browser);

function test(val) {
  return val;
}
