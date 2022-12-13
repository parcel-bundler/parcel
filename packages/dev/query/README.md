# `parcel-query`

A REPL to investigate the Parcel graphs in the cache ("offline", after the build).

## Installation

Clone and run `yarn`, then `cd packages/dev/query && yarn link` to make the `parcel-query` binary
globally available.

## Usage

Call `.help` to view a list of commands.

In a project root containing a `.parcel-cache` folder:

```sh
$ parcel-query
> .findBundleReason 27494aebac508bd8 TJbGI
# Asset is main entry of bundle: false
# Asset is an entry of bundle: false
# Incoming dependencies contained in the bundle:
{
  id: '3fd182662e2a6fa9',
  type: 'dependency',
  value: {
    specifier: '../../foo',
    specifierType: 0,
...
```

In the `.getAsset 3Xzt5` variant, no quotes/parenthesis are
needed. Alternatively, you can use proper JS: `getAsset("3Xzt5")`.

The variables `assetGraph` and `bundleGraph` contain the deserialized objects.

For a single query, the command (which has to be a JS call) can be specified as a CLI parameter (the
disadvantage here is that the graphs have to be loaded on every call as opposed to once when
starting the REPL):

```sh
$ parcel-query 'findBundleReason("b0696febf20b57ce", "bNAUZ")'
```
