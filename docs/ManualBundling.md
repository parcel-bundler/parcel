## Manual Bundles

_Note: This feature is EXPERIMENTAL, meaning it may act strange in unusal cases, and may not have full test coverage._

Parcel automatically code splits for certain import types, and automatically generates shared bundles based on a deduplication approach. Manual Bundles allow the user the specfiy their own, custom bundles and their contents.

This document aims to explain the current implementation of Manual Bundling, for information on using the feature visit the Parcel Docs.

### Generate Asset Lookups

First, we generate a look up, `manualAssetToConfig` which contains an Asset Node as a key, mapped to which config object the asset is valid for. For example, given the config below,

```json
{
  "@parcel/bundler-default": {
    "unstable_manualSharedBundles": [
      {
        "name": "",
        "root": "manual.js",
        "assets": ["**/*"],
        "types": ["js"]
      },
      {
        "name": "",
        "root": "manual.js",
        "assets": ["foo.js"],
        "types": ["js"]
      }
    ]
  }
}
```

The generate the `manualAssetToConfig` we need to track which parents (if any) exist in the project. Users specify the parent based on file name, so we need to find `parentToAssetConfig`, which would look something like this:

```js
parentsToConfig =  {
  "project/root/manual.js" => {
    {
        "name": "",
        "root": "manual.js",
        "assets": ["**/*"],
        "types": ["js"]
    },
    {
        "name": "",
        "root": "manual.js",
        "assets": ["foo.js"],
        "types": ["js"]
    }
  }
}

```

And the manualAssetToConfig would look something like this:

```js
manualAssetsToConfig =  {
  "project/root/a.js" => {
    {
        "name": "",
        "root": "manual.js",
        "assets": ["**/*"],
        "types": ["js"]
    },
  }
  "project/root/foo.js" => {
    {
        "name": "",
        "root": "manual.js",
        "assets": ["foo.js"],
        "types": ["js"]
    }
  }
}
```

### Override Traditional Shared Bundles

### More Info

For config information visit, the Parcel documentation's section on MSBs. For a more detailed example, check out the Manual Bundles Example in [Bundler Examples](BundlerExamples.md).
