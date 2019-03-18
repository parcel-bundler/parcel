module.exports = () => process.env.NODE_ENV + test(process.env.NODE_ENV);

function test(str) {
  return ':' + str;
}
