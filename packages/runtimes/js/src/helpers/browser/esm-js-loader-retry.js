async function load(id) {
  if (!atlaspackRequire.retryState) {
    atlaspackRequire.retryState = {};
  }

  if (!globalThis.navigator.onLine) {
    await new Promise(res =>
      globalThis.addEventListener('online', res, {once: true}),
    );
  }

  let url = require('../bundle-manifest').resolve(id);

  if (atlaspackRequire.retryState[id] != undefined) {
    url = `${url}?retry=${atlaspackRequire.retryState[id]}`;
  }

  try {
    // eslint-disable-next-line no-undef
    return await __atlaspack__import__(url);
  } catch (error) {
    atlaspackRequire.retryState[id] = Date.now();
  }
}

module.exports = load;
