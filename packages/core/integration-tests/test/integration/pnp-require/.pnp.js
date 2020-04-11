const path = require('path');

const resolve = request => {
  if (request === 'testmodule') {
    return path.join(__dirname, 'pnp', 'testmodule');
  } else {
    // The plugins from the parcel config are also resolved through this function
    return require.resolve(request);
  }
};

module.exports = {resolveToUnqualified: resolve, resolveRequest: resolve};
