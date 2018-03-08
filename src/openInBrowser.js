const opn = require('opn');

const openInBrowser = (url, browser) => {
  try {
    const options = typeof browser === 'string' ? {app: browser} : undefined;

    opn(url, options).catch(() => {}); // Prevent `unhandledRejection` error.
    return true;
  } catch (err) {
    return false;
  }
};

module.exports = openInBrowser;
