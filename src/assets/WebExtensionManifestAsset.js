const Asset = require('../Asset');

class WebExtensionManifestAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'json';
    this.isAstDirty = false;
  }

  parse(code) {
    return JSON.parse(code);
  }

  processSingleDependency(path, opts) {
    opts = opts || {entry: true};
    let assetPath = this.addURLDependency(path, opts);
    return assetPath;
  }

  processMultipleDependencies(filenames, opts) {
    return filenames.map(filename =>
      this.processSingleDependency(filename, opts)
    );
  }

  processBackground(nodeName) {
    if (nodeName !== 'background') {
      return;
    }

    const node = this.ast[nodeName];
    if (node.scripts) {
      node.scripts = this.processMultipleDependencies(node.scripts);
      this.isAstDirty = true;
    }
    if (node.page) {
      node.page = this.processSingleDependency(node.page);
      this.isAstDirty = true;
    }
  }

  processContentScripts(nodeName) {
    if (nodeName !== 'content_scripts') {
      return;
    }

    const contentScriptsNode = this.ast[nodeName];
    if (!Array.isArray(contentScriptsNode)) {
      return;
    }
    for (const script of contentScriptsNode) {
      if (script.js) {
        script.js = this.processMultipleDependencies(script.js);
        this.isAstDirty = true;
      }
    }
  }

  processBrowserOrPageAction(nodeName) {
    if (!['browser_action', 'page_action'].includes(nodeName)) {
      return;
    }

    const node = this.ast[nodeName];
    if (node.default_popup) {
      node.default_popup = this.processSingleDependency(node.default_popup);
      this.isAstDirty = true;
    }
  }

  collectDependencies() {
    for (const nodeName of Object.keys(this.ast)) {
      this.processBackground(nodeName);
      this.processContentScripts(nodeName);
      this.processBrowserOrPageAction(nodeName);
    }
  }

  generate() {
    if (this.isAstDirty) {
      return JSON.stringify(this.ast);
    }

    return this.contents;
  }
}

module.exports = WebExtensionManifestAsset;
