const path = require('path');
const Asset = require('../Asset');

/**
 * A shared asset that handles:
 * - PWA .webmanifest
 * - PWA manifest.json
 * - WebExtension manifest.json
 */
class ManifestAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type =
      path.basename(name) === 'manifest.json' ? 'json' : 'webmanifest';
    this.isAstDirty = false;
  }

  parse(code) {
    return JSON.parse(code);
  }

  processSingleDependency(path, opts) {
    opts = opts || {entry: true};
    return this.addURLDependency(path, opts);
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

    const background = this.ast[nodeName];
    if (Array.isArray(background.scripts)) {
      background.scripts = this.processMultipleDependencies(background.scripts);
      this.isAstDirty = true;
    }
    if (background.page) {
      background.page = this.processSingleDependency(background.page);
      this.isAstDirty = true;
    }
  }

  processContentScripts(nodeName) {
    if (nodeName !== 'content_scripts') {
      return;
    }

    const contentScripts = this.ast[nodeName];
    if (!Array.isArray(contentScripts)) {
      return;
    }
    for (const script of contentScripts) {
      if (script.js) {
        script.js = this.processMultipleDependencies(script.js);
        this.isAstDirty = true;
      }
      if (script.css) {
        script.css = this.processMultipleDependencies(script.css);
        this.isAstDirty = true;
      }
    }
  }

  processWebAccessibleResources(nodeName) {
    if (nodeName !== 'web_accessible_resources') {
      return;
    }

    const webAccessibleResources = this.ast[nodeName];
    if (!Array.isArray(webAccessibleResources)) {
      return;
    }
    this.ast[nodeName] = this.processMultipleDependencies(
      webAccessibleResources
    );
    this.isAstDirty = true;
  }

  processBrowserOrPageAction(nodeName) {
    if (!['browser_action', 'page_action'].includes(nodeName)) {
      return;
    }

    const action = this.ast[nodeName];
    if (action.default_popup) {
      action.default_popup = this.processSingleDependency(action.default_popup);
      this.isAstDirty = true;
    }
    if (action.default_icon) {
      action.default_icon = this.processSingleDependency(action.default_icon);
      this.isAstDirty = true;
    }
  }

  processIcons(nodeName) {
    if (nodeName !== 'icons') {
      return;
    }

    const icons = this.ast[nodeName];
    for (const size of Object.keys(icons)) {
      icons[size] = this.processSingleDependency(icons[size]);
      this.isAstDirty = true;
    }
  }

  collectDependenciesForWebExtension() {
    for (const nodeName of Object.keys(this.ast)) {
      this.processBackground(nodeName);
      this.processContentScripts(nodeName);
      this.processWebAccessibleResources(nodeName);
      this.processBrowserOrPageAction(nodeName);
      this.processIcons(nodeName);
    }
  }

  collectDependenciesForPwa() {
    if (Array.isArray(this.ast.icons)) {
      for (let icon of this.ast.icons) {
        icon.src = this.addURLDependency(icon.src);
      }
    }

    if (Array.isArray(this.ast.screenshots)) {
      for (let shot of this.ast.screenshots) {
        shot.src = this.addURLDependency(shot.src);
      }
    }

    if (this.ast.serviceworker && this.ast.serviceworker.src) {
      this.ast.serviceworker.src = this.addURLDependency(
        this.ast.serviceworker.src
      );
    }
  }

  hasWebExtensionManifestKeys() {
    const requiredKeys = ['manifest_version', 'name', 'version'];
    const presentKeys = Object.keys(this.ast).filter(key =>
      requiredKeys.includes(key)
    );
    return presentKeys.length === requiredKeys.length;
  }

  collectDependencies() {
    if (this.hasWebExtensionManifestKeys()) {
      this.collectDependenciesForWebExtension();
    } else {
      this.collectDependenciesForPwa();
    }
  }

  generate() {
    if (this.isAstDirty) {
      return JSON.stringify(this.ast);
    }

    return this.contents;
  }
}

module.exports = ManifestAsset;
