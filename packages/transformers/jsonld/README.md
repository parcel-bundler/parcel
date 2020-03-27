# jsonld transformer

[what is jsonld?](https://json-ld.org/)

map transformers to asset types [config file](https://github.com/parcel-bundler/parcel/blob/v2/packages/configs/default/index.json)

## Feature Requirements

- Parsing and collecting dependencies
- Rewriting urls to dependencies
- Compiling back to JSON

## parcel v1 code

- implementation [JSONLDAsset.js](https://github.com/parcel-bundler/parcel/blob/1.x/src/assets/JSONLDAsset.js)
- test [schema-jsonld.js](https://github.com/parcel-bundler/parcel/blob/v2/packages/core/integration-tests/test/schema-jsonld.js)

#### issues 🐛

- the jsonld is not outputting back into the built index.html file

#### to do 📓

- port code that adds dependencies found in the attribute list

## Relevant Projects

- [jsonld.js](https://github.com/digitalbazaar/jsonld.js)
- [jsonld-streaming-parser.js](https://github.com/rubensworks/jsonld-streaming-parser.js)
- [jsonld-streaming-serializer](https://github.com/rubensworks/jsonld-streaming-serializer.js)