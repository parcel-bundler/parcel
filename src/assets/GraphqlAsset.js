const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const Resolver = require('../Resolver');
const fs = require('../utils/fs');
const os = require('os');

const IMPORT_RE = /^# *import +['"](.*)['"] *;? *$/;

class GraphqlAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';

    this.gqlMap = new Map();
    this.gqlResolver = new Resolver(
      Object.assign({}, this.options, {
        extensions: ['.gql', '.graphql']
      })
    );
  }

  async traverseImports(name, code) {
    this.gqlMap.set(name, code);

    await Promise.all(
      code
        .split(/\r\n?|\n/)
        .map(line => line.match(IMPORT_RE))
        .filter(match => !!match)
        .map(async ([, importName]) => {
          let {path: resolved} = await this.gqlResolver.resolve(
            importName,
            name
          );

          if (this.gqlMap.has(resolved)) {
            return;
          }

          let code = await fs.readFile(resolved, 'utf8');
          await this.traverseImports(resolved, code);
        })
    );
  }

  collectDependencies() {
    for (let [path] of this.gqlMap) {
      this.addDependency(path, {includedInParent: true});
    }
  }

  async parse(code) {
    let gql = await localRequire('graphql-tag', this.name);

    await this.traverseImports(this.name, code);

    const allCodes = [...this.gqlMap.values()].join(os.EOL);

    return gql(allCodes);
  }

  generate() {
    return `module.exports=${JSON.stringify(this.ast, false, 2)};`;
  }
}

module.exports = GraphqlAsset;
