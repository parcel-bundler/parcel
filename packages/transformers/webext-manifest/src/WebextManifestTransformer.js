// @flow
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json
// https://developer.chrome.com/extensions/manifest

import path from 'path';
import glob from 'fast-glob';
import {Transformer} from '@parcel/plugin';
import type {MutableAsset} from '@parcel/types';

type JsonObject = {[string]: any};

const addDep = (asset: MutableAsset, dep: string) =>
  dep && asset.addURLDependency(dep, {});

const handleObject = (asset: MutableAsset, o) =>
  Object.keys(o).reduce((acc, k) => {
    acc[k] = addDep(asset, o[k]);
    return acc;
  }, {});

const handleStringOrObject = (asset: MutableAsset, dep) => {
  if (typeof dep === 'string') {
    return addDep(asset, dep);
  }
  return handleObject(asset, dep);
};

const handleHtml = (asset: MutableAsset, dep) =>
  asset.addURLDependency(dep, {isEntry: true});

const handleThemeIcons = (asset: MutableAsset, list) => {
  if (!Array.isArray(list)) {
    return list;
  }
  return list.map(({size, light, dark}) => ({
    size,
    light: addDep(asset, light),
    dark: addDep(asset, dark)
  }));
};

const handleArray = (asset: MutableAsset, list) => {
  if (!Array.isArray(list)) {
    return list;
  }
  return list.map(dep => addDep(asset, dep));
};

const handleContentScripts = (asset: MutableAsset, list) => {
  if (!Array.isArray(list)) {
    return list;
  }
  return list.map(({js, css, ...rest}) => ({
    ...rest,
    js: handleArray(asset, js),
    css: handleArray(asset, css)
  }));
};

const handleGlobs = (asset: MutableAsset, list) => {
  if (!Array.isArray(list)) {
    return list;
  }
  const dir = path.dirname(asset.filePath);
  const deps = list.reduce((acc, pattern) => {
    const files = glob
      .sync(path.resolve(dir, pattern), {})
      .map(file => path.relative(dir, file));
    acc = acc.concat(files);
    return acc;
  }, []);
  return handleArray(asset, deps);
};

const collectDependencies = (deps: JsonObject) => (
  asset: MutableAsset,
  json: JsonObject
) =>
  Object.keys(deps).reduce(
    (acc: JsonObject, key: string) => {
      const value = json[key];
      if (value) {
        const handler = deps[key];
        acc[key] = handler(asset, value);
      }
      return acc;
    },
    {...json}
  );

const handleAction = collectDependencies({
  default_icon: handleStringOrObject,
  default_popup: handleHtml,
  default_panel: handleHtml,
  theme_icons: handleThemeIcons
});

const DEPS = {
  page_action: handleAction,
  browser_action: handleAction,
  sidebar_action: handleAction,

  icons: handleObject,
  devtools_page: handleHtml,
  options_page: handleHtml,
  options_ui: collectDependencies({
    page: handleHtml
  }),
  chrome_url_overrides: collectDependencies({
    bookmarks: handleHtml,
    newtab: handleHtml,
    history: handleHtml
  }),
  chrome_settings_overrides: collectDependencies({
    homepage: handleHtml
  }),

  background: collectDependencies({
    scripts: handleArray,
    page: handleHtml
  }),
  content_scripts: handleContentScripts,
  web_accessible_resources: handleGlobs,

  theme: collectDependencies({
    images: handleObject
  })
};

export default new Transformer({
  async transform({asset}) {
    if (asset.env.context === 'pwa-manifest') {
      asset.type = 'webmanifest';
    }
    const json = JSON.parse(await asset.getCode());
    const result = collectDependencies(DEPS)(asset, json);
    // FIXME
    asset.setCode(JSON.stringify(result, null, 2));
    return [asset];
  }
});
