function run() {
  let result = [process.pid];
  return new Promise((resolve, reject) => {
    process.parcelRequest({
      location: require.resolve('./master-process-id.js'),
      args: []
    }).then((pid) => {
      result.push(pid)
      resolve(result);
    }).catch(reject);
  });
}

function init() {
  // Do nothing
}

exports.run = run;
exports.init = init;