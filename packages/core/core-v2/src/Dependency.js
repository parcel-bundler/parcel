class Dependency {
  constructor(dep, parentAsset) {
    this.parentId = parentAsset.id;
    this.moduleSpecifier = dep.moduleSpecifier;
    this.resolvedPath = dep.resolvedPath;
    this.loc = dep.loc;
    this.env = Object.assign({}, parentAsset.env, dep.env);
    this.isAsync = dep.isAsync || false;
    this.isEntry = dep.isEntry || false;
    this.isOptional = dep.isOptional || false;
    this.isIncluded = dep.isIncluded || false;
    this.meta = dep.fileTypeMeta || {};
  }
}

module.exports = Dependency;
