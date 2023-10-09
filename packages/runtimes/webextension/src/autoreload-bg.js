/* global chrome, browser */
let env = typeof browser === 'undefined' ? chrome : browser;
let origReload = env.runtime.reload;
let avoidID = -1;

let promisify =
  (obj, fn) =>
  (...args) => {
    if (typeof browser === 'undefined') {
      return new Promise((resolve, reject) =>
        obj[fn](...args, res =>
          env.runtime.lastError ? reject(env.runtime.lastError) : resolve(res),
        ),
      );
    }
    return obj[fn](...args);
  };

let queryTabs = promisify(env.tabs, 'query');
let messageTab = promisify(env.tabs, 'sendMessage');

env.runtime.reload = () => {
  queryTabs({})
    .then(tabs => {
      return Promise.all(
        tabs.map(tab => {
          if (tab.id === avoidID) return;
          return messageTab(tab.id, {
            __parcel_hmr_reload__: true,
          }).catch(() => {});
        }),
      );
    })
    .then(() => {
      origReload.call(env.runtime);
    });
};

env.runtime.onMessage.addListener((msg, sender) => {
  if (msg.__parcel_hmr_reload__) {
    avoidID = sender.tab.id;
    env.runtime.reload();
  }
});
