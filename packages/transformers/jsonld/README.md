# jsonld transformer

[what is jsonld?](https://json-ld.org/)

what is a "transformer"? from devon @ [parcel-2-is-here](https://medium.com/@devongovett/parcel-2-0-0-alpha-1-is-here-8b160c6e3f7e)

    transformers compile code and other assets from one language to another, or just transform files in some way. For example, the TypeScript transformer compiles TypeScript to JavaScript, and the Babel transformer transpiles JavaScript to different JavaScript. Transformers are also responsible for extracting dependencies from code, such as import statements and require calls, which get passed back to the resolver, to another transformer, and so on until a full asset graph for the application is built.

Transformers get mapped to asset types through a config file located [here](https://github.com/parcel-bundler/parcel/blob/v2/packages/configs/default/index.json)

## Feature Requirements

- Parsing and collecting dependencies 
    - the old code seems to only care about image dependencies -- won't jsonld lead to other kinds of media dependencies?
- Rewriting urls to dependencies
- Compiling back to JSON
    - this part should be handled by the JSONTransformer by setting `asset.type = "json"`

## parcel v1 code

- implementation [JSONLDAsset.js](https://github.com/parcel-bundler/parcel/blob/1.x/src/assets/JSONLDAsset.js)
- test [schema-jsonld.js](https://github.com/parcel-bundler/parcel/blob/v2/packages/core/integration-tests/test/schema-jsonld.js)

#### issues 🐛

- the jsonld is not outputting the json data back into the built index.html file in the proper format
    - the data injected into the index.html isn't a pure json object but is wrapped in JS code
- unable to get the `publicURL` config option from the available objects passed into the transform object
    - `--public-url https://place.holder/` is being passed to the `parcel build` command, however, logs do not show it appearing anywhere
- the `asset.addURLDependency()` is returning a number, which causes `urlJoin()` to throw an error
    - this logic is ported directly from v1 code, so it seems that the addURLDependency has changed what it returns for v2 changes??

#### to do 📓

- port code that adds dependencies found in the attribute list ✔️
- the asset paths in the jsonld object should be updated with the new asset paths returned from `asset.addURLDependency()` ✔️
- resolve all issues (0/3)
- remove `console.logs()`
- write unit tests or run existing integration test

## Relevant Projects

- [jsonld.js](https://github.com/digitalbazaar/jsonld.js)
- [jsonld-streaming-parser.js](https://github.com/rubensworks/jsonld-streaming-parser.js)
- [jsonld-streaming-serializer](https://github.com/rubensworks/jsonld-streaming-serializer.js)