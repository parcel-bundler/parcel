let childRef = undefined;

function addFunctions(workerFunctions) {
  Object.keys(workerFunctions).forEach(workerPath => {
    let functions = workerFunctions[workerPath];
    // Set child reference if it's requested, mainly used in tests
    if (require(workerPath).setChildReference) {
      require(workerPath).setChildReference(childRef);
    }
    // Loop through all functions
    functions.forEach(f => {
      // Overwrite if exists
      exports[f] = require(workerPath)[f];
    });
  });
}

function setChildReference(child) {
  childRef = child;
}

exports.addFunctions = addFunctions;
exports.setChildReference = setChildReference;
