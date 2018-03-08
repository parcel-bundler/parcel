const opn = require('opn');
const execSync = require('child_process').execSync;

const openInBrowser = (url, browser) => {
  const OSX_CHROME = 'google chrome';

  const isBrowserString = typeof browser === 'string';

  const shouldTryOpenChromeWithAppleScript =
    process.platform === 'darwin' &&
    (!isBrowserString || browser === OSX_CHROME);

  if (shouldTryOpenChromeWithAppleScript) {
    try {
      // check if chrome is running
      execSync('ps cax | grep "Google Chrome"');
      const command = `osascript -l JavaScript reuseChromeTabInMacOS.js ${encodeURI(
        url
      )}`;
      // try our best to reuse existing tab
      execSync(command, {
        cwd: __dirname,
        stdio: 'ignore'
      });
      return true;
    } catch (err) {
      // Ignore errors.
    }
  }

  // Fallback to opn
  // (It will always open new tab)
  try {
    const options = isBrowserString ? {app: browser} : undefined;

    opn(url, options).catch(() => {}); // Prevent `unhandledRejection` error.
    return true;
  } catch (err) {
    return false;
  }
};

module.exports = openInBrowser;
