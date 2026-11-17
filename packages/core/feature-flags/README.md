# Feature flags

## Disabling generated import maps

Parcel generates inline import maps for supported browser targets by default.
For web extensions or websites whose Content Security Policy forbids inline
scripts, disable generated import maps with:

```sh
parcel build src/manifest.json --feature-flag useImportMaps=false
```

The JavaScript API accepts the same setting:

```js
new Parcel({
  entries: 'src/manifest.json',
  defaultConfig: '@parcel/config-webextension',
  featureFlags: {useImportMaps: false},
});
```

This disables both generated HTML import maps and the JavaScript runtime's
reliance on them. Dynamic imports continue to work using Parcel's fallback
loading mechanism. Author-provided import maps and other inline scripts are
not removed.
