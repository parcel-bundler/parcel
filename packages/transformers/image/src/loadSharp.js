// This is used to load sharp on the main thread, which prevents errors when worker threads exit
// See https://sharp.pixelplumbing.com/install#worker-threads and https://github.com/lovell/sharp/issues/2263
module.exports = () => {
  require('sharp');
};
