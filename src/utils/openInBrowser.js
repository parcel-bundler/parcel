const opn = require('opn');

const openInBrowser = async (url, browser) => {
  try {
    const options = typeof browser === 'string' ? {app: browser} : undefined;

    await opn(url, options);
  } catch (err) {
    console.error(`Unexpected error while opening in browser: ${browser}`);
    console.error(err);
  }
};

module.exports = openInBrowser;
