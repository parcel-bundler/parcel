const path = require('path');

const resolve = request => {
  if (request === 'module/') {
    return path.join(__dirname, 'pnp', 'module');
  } else if (request === 'pnpapi') {
    return __filename;
  } else {
    // The plugins from the parcel config are also resolved through this function
    return require.resolve(request);
  }
};

module.exports = {resolveToUnqualified: resolve, resolveRequest: resolve};
