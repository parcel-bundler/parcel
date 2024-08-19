## Manual Bundles

_Note: This feature is EXPERIMENTAL, meaning it may act strange in unusual cases, and may not have full test coverage._

Atlaspack automatically code splits for certain import types, and automatically generates shared bundles based on a deduplication approach. Manual Bundles allow the user to specify their own custom bundles and their contents.

This document aims to explain the current implementation of Manual Bundling, for information on using the feature visit the Atlaspack Docs.

### Generate Asset Lookups

First, we generate a look up, `manualAssetToConfig`, which contains an Asset Node as a key, mapped to which config object the asset is valid for. Consider the config below.

```json
{
  "@atlaspack/bundler-default": {
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

To generate the `manualAssetToConfig` we need to track which parents or roots (if any) exist in the project. Users specify the root based on file name, so we need to find `parentToAssetConfig`, which would look something like this:

- "root" refers to the property on the config, however, within the code we call this the "parent". "parent" refers to the relationship between the imports that match the glob and the asset specified by the "root" property. This is because the word "root" has become overloaded, since we call any entry to a bundle, a "bundleRoot".

```json
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

Once we've obtained the `parentsToConfig`, we traverse the assetgraph from each parent, searching for assets that match the specified glob. If a user did not specify a "root", we will simply traverse the entire `AssetGraph` in search of assets that match the glob.

```js
assetGraph.traverse((node, _, actions) => {
        ...
        // find matched node
      }, parentAsset);
```

And the manualAssetToConfig would then looks something like this:

```json
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

The config object in the value of the above map is referred to as the "manualSharedObject".

### Override Traditional Code Split Bundles

During **Step Create Bundles**, bundles are created for explicit code split points. We must override any assets which match any manual globs.

```js
// MSB Step 1: Match glob on file path and type for any asset
let manualSharedBundleKey;
let manualSharedObject = manualAssetToConfig.get(childAsset);
```

Since we have a lookup, we attempt to grab the `manualSharedObject` for an asset, and then generate a key with which we can index the bundle later.

```js
if (manualSharedObject) {
  // MSB Step 2: Generate a key for which to look up this manual bundle with
  manualSharedBundleKey = manualSharedObject.name + ',' + childAsset.type;
}
```

The key will be used to find the manual bundle for this exact asset, and then we add the asset to the bundle as usual.

#### Internalized Bundles for Manual Shared Bundles

When creating bundles for explicit code split points, there is a possibility of multiple asynchronous assets being placed into a singular manual bundle. Because of this, we need to track the excess and internalize them.

```js
if (manualSharedObject) {
  // MSB Step 4: If this was the first instance of a match, mark mainAsset for internalization
  // since MSBs should not have main entry assets
  manualBundleToInternalizedAsset.get(bundleId).push(childAsset);
}
```

To do this we collect all async assets in a manual bundle, and set the appropriate bundle property (`bundle.internalizedAssets`) afterwards. Internalization marks async assets that should now be loaded as synchronous assets.

### Override Traditional Shared Bundles

During asset placement (see Asset Placement in [DefaultBundler.md](DefaultBundler.md) for more info), we override shared bundles. Assets needed by entries are still placed in entries, but before we consider our asset, `a`, for reused or shared bundles, we check if it should be placed in a manualSharedBundle.

```

if (manualSharedObject && !reachable.empty()) {

```

Next we generate our `manualSharedBundleKey` which is just the config name and asset type, and look up the `bundleId` in the `manualSharedMap`. Then we simply process the asset as usual: create a bundle if it doesn't exist, otherwise just add it on.

```

bundle = createBundle({
uniqueKey: manualSharedObject.name + firstSourceBundle.type,
target: firstSourceBundle.target,
type: firstSourceBundle.type,
env: firstSourceBundle.env,
manualSharedBundle: manualSharedObject?.name,
});

```

The `manualSharedBundle` property and the `uniqueKey` property both store the name of the bundle, and can be read in namers or other plugins to influence your manual shared bundle.

### More Info

For config information visit the Atlaspack documentation's section on MSBs. For a more detailed example, check out the Manual Bundles Example in [Bundler Examples](BundlerExamples.md)
