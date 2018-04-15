let options = {};
let child;

function setChildReference(childRef) {
  child = childRef;
}

function run(a, b) {
  return new Promise((resolve, reject) => {
    child.addCall({
      location: require.resolve('./master-sum.js'),
      args: [a, b]
    }).then(resolve).catch(reject);
  });
}

function init() {
  // Do nothing
}

exports.run = run;
exports.init = init;
exports.setChildReference = setChildReference;