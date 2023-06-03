/* global chrome, browser */
let env = typeof browser === 'undefined' ? chrome : browser;
let origReload = env.runtime.reload;
let avoidID = -1;

env.runtime.reload = () => {
  env.tabs
    .query({})
    .then(tabs => {
      return Promise.all(
        tabs.map(tab => {
          if (tab.id === avoidID) return;
          return env.tabs
            .sendMessage(tab.id, {
              __parcel_hmr_reload__: true,
            })
            .catch(() => {});
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
