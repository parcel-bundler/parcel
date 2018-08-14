const AssetGraph = require('./AssetGraph');
const Queue = require('./Queue');
const Emittery = require('emittery');



export default class AssetGraphBuilder extends Emittery {
  constructor() {
    super();
    
    this.assetGraph = new AssetGraph();
    this.transformQueue = new Queue();
    this.resolver = new Resolver();
  }

  async build(entries) {
    entries.forEach((moduleSpecifier) => {
      this.processModuleRequest({
        srcPath: cwd,
        moduleSpecifier
      })
    });
  }

  async update(event) {
    
  }

  async processModuleRequest(moduleRequest) {
    let resolvedPath = this.resolver.resolve(moduleRequest);
    
  }

  async transformInWorker(filePath) {

  }
}
