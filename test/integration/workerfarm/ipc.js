async function run(a, b) {
  return process.parcelRequest({
    location: require.resolve('./master-sum.js'),
    args: [a, b]
  });
}

function init() {
  // Do nothing
}

exports.run = run;
exports.init = init;