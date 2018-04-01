let options = {};
let child;

function setChildReference(childRef) {
  child = childRef;
}

function run(a, b) {
  return new Promise(resolve => {
    child.addCall({
      location: '../../test/integration/workerfarm/master-sum.js',
      args: [a, b]
    }).then(resolve).catch(e => console.error(e));
  });
}

function init() {
  // Do nothing
}

exports.run = run;
exports.init = init;
exports.setChildReference = setChildReference;