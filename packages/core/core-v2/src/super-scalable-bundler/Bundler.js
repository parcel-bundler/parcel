import path from 'path';
import chalk from 'chalk';
import findUp from 'find-up';
import mapObj from 'map-obj';
import PQueue from 'p-queue';

import Querral from './Querral';
import {
  readFile,
  writeFile,
  mkdirp,
  appendFile,
} from './fsPromisified';
import Resolver from './Resolver';
import AssetProcessor from './AssetProcessor';
import level from 'level';

let cache = level(path.join(process.cwd(), '.bundler-cache'));

class AssetReference {
  constructor(filePath) {
    this.id = AssetReference.generateId(filePath);
    this.filePath = filePath;
    this.depMapping = {};
  }

  static generateId(filePath) {
    let regex = new RegExp(`^${process.cwd()}`);
    return filePath.replace(regex, '');
  }

  async getProcessed() {
    let processed = await cache.get(`processed:${this.id}`);
    return processed;
  }

  async setProcessed(processed) {
    await cache.put(`processed:${this.id}`, processed);
  }
}

class AssetGraph {
  constructor({ entryPath }) {
    this.graph = new Map();
    this.entryAsset = new AssetReference(entryPath);
    this.graph.set(entryPath, this.entryAsset);
  }

  get(filePath) {
    let asset = this.graph.get(filePath);
    
    if (!asset) {
      asset = new AssetReference(filePath);
      this.graph.set(filePath, asset);
    }

    return asset;
  }

  addRelationship({ sourcePath, moduleIdentifier, resolvedPath }) {
    let asset = this.get(sourcePath);
    let depAsset = this.get(resolvedPath);
    asset.depMapping[moduleIdentifier] = depAsset.id;
  }
}

export default class Bundler {
  constructor(entryRequest) {
    this.entryRequest = entryRequest;
    this.cwd = process.cwd();
    
    this.assetGraph = new AssetGraph({ entryPath: this.cwd })
    this.resolver = new Resolver();
    this.assetProcessor = new AssetProcessor();

    this.resolver.on('resolved', (resolvedModuleRequest) => {
      let { resolvedPath } = resolvedModuleRequest;
      this.assetGraph.addRelationship(resolvedModuleRequest);
      let asset = this.assetGraph.get(resolvedPath);
      this.assetProcessor.process(asset);
    });
    this.assetProcessor.on('foundDepRequest', (moduleRequest) => this.resolver.resolve(moduleRequest));
    
    this.processQuerral = new Querral([
      this.resolver.queue,
      this.assetProcessor.queue,
    ]);
  }
  
  async bundle() {
    await this.processAssets();

    await this.packageAssetsIntoBundles();

    console.log(chalk.green('Done Done!'));
  }

  async processAssets() {
    this.resolver.resolve({
      sourcePath: this.cwd,
      moduleIdentifier: this.entryRequest
    });

    await this.processQuerral.allDone();

    console.log(chalk.green('Done Processing!'))
  }

  async packageAssetsIntoBundles() {
    await mkdirp('dist');
    
    // wrapper code taken from https://github.com/ronami/minipack/blob/master/src/minipack.js
    const topWrapper = `
      (function(modules) {
        function require(id) {
          const [fn, mapping] = modules[id];

          function localRequire(name) {
            return require(mapping[name]);
          }

          const module = { exports : {} };

          fn(localRequire, module, module.exports);

          return module.exports;
        }

        require(0);
      })({`; 
    await writeFile('dist/bundle.js', topWrapper, 'utf8');

    for (let [filePath, asset] of this.assetGraph.graph) {
      let { id, depMapping } = asset;
      let { code } = await asset.getProcessed();
      let moduleWrapper = `${id}: [
        function (require, module, exports) {
          ${code}
        },
        ${JSON.stringify(depMapping)},
      ],`;

      await appendFile('dist/bundle.js', moduleWrapper);
    }

    await appendFile('dist/bundle.js', '})');

    console.log(chalk.green('Done Bundling!'));
  }
}
