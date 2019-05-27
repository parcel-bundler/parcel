# Transformers

Transformers have three roles: to transform an assets content from one form to another, to create additional assets, and to register dependencies and connected files.

### Transform / Compile

Converts the assets content from one structure to another.

**Common Examples**

- Babel: Transforms latest JavaScript to browser compatible JavaScript
- SASS: Compiles sass files into css files

### Create Assets

Dynamic create new assets based on the assets provided.

**Common Examples**

- Babel: Transforms latest JavaScript to browser compatible JavaScript
- SASS: Compiles sass files into css files
- CSSModules: Produces JavaScript files to be imported

### Register Dependencies

Examine and determine dependencies of a given asset.

**Common Examples**

- HTML: Finds and adds linked files into the tree
- JS: Reads imports and require statements to find dependencies

## Configuration

Transformers are defined in the "transformers" key of configuration. For the default configuration, see
./packages/configs/default/index.json

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
