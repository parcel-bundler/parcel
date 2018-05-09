const WebManifestAsset = {
  type: 'webmanifest',

  parse(content) {
    return JSON.parse(content);
  },

  collectDependencies(ast, state) {
    if (Array.isArray(ast.icons)) {
      for (let icon of ast.icons) {
        icon.src = state.addURLDependency(icon.src);
      }
    }

    if (Array.isArray(ast.screenshots)) {
      for (let shot of ast.screenshots) {
        shot.src = state.addURLDependency(shot.src);
      }
    }

    if (ast.serviceworker && ast.serviceworker.src) {
      ast.serviceworker.src = state.addURLDependency(ast.serviceworker.src);
    }
  },

  generate(ast) {
    return JSON.stringify(ast);
  }
};

module.exports = {
  Asset: {
    webmanifest: WebManifestAsset
  }
};
