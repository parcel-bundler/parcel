# Transformers

A transformer allows you to access and perform transformative operations on an asset.

Transformers are defined in: `./packages/configs/default/index.json`

Transformers are ran in order by file type. It is recommended to have more specialized transformers first, and have them skip assets that don't match their case.

## Transformer Life Cycle

Below is the list of the life cycle methods in the order they are called.

### `getConfig`

Loads configuration specifically for this transformer.

**API**

```
getConfig ({
  asset: MutableAsset,
  options: Object,
  resolver: (from: FilePath, to: string) => FilePath
}) => Object
```

### `canReuseAST`

If the asset has already been parsed, this will be called to ensure that this transformer can used the previously parsed AST.

**API**

```
canReuseAST({ast: AST, options: Object}) => Boolean
```

### `parse`

Parsed the asset code into an AST

**API**

```
parse({
  asset: MutableAsset,
  config: Object
  options: Object,
}) => AST
```

### `transform`

Performs transformations on the assets and allows for sending back additional assets to be added to the bundle graph.

**API**

```
transform({
  asset: MutableAsset,
  config: Object
  options: Object,
}) => Array<Asset>
```

### `generate`

Generates the output code to be written to the bundled output. This can also include source maps.

**API**

```
generate({
  asset: MutableAsset,
  config: Object
  options: Object,
}) => {code: string, map: ?SourceMap}
```
