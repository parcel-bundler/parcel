const commonText = require('./common').commonFunction('Worker');

self.addEventListener('message', () => {
  self.postMessage(commonText);
});
