const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const {promisify} = require('@parcel/utils');
const path = require('path');
const os = require('os');
const Resolver = require('../Resolver');
const parseCSSImport = require('../utils/parseCSSImport');

class SASSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async parse(code) {
    // node-sass or dart-sass should be installed locally in the module that's being required
    let sass = await getSassRuntime(this.name);
    let render = promisify(sass.render.bind(sass));
    const resolver = new Resolver({
      extensions: ['.scss', '.sass'],
      rootDir: this.options.rootDir
    });

    let opts =
      (await this.getConfig(['.sassrc', '.sassrc.js'], {packageKey: 'sass'})) ||
      {};
    opts.includePaths = (opts.includePaths
      ? opts.includePaths.map(includePath => path.resolve(includePath))
      : []
    ).concat(path.dirname(this.name));
    opts.data = opts.data ? opts.data + os.EOL + code : code;
    let type = this.options.rendition
      ? this.options.rendition.type
      : path
          .extname(this.name)
          .toLowerCase()
          .replace('.', '');
    opts.indentedSyntax =
      typeof opts.indentedSyntax === 'boolean'
        ? opts.indentedSyntax
        : type === 'sass';

    opts.importer = opts.importer || [];
    opts.importer = Array.isArray(opts.importer)
      ? opts.importer
      : [opts.importer];
    opts.importer.push((url, prev, done) => {
      url = parseCSSImport(url);
      resolver
        .resolve(url, prev === 'stdin' ? this.name : prev)
        .then(resolved => resolved.path)
        .catch(() => url)
        .then(file => done({file}))
        .catch(err => done(normalizeError(err)));
    });

    try {
      return await render(opts);
    } catch (err) {
      // Format the error so it can be handled by parcel's prettyError
      if (err.formatted) {
        throw sassToCodeFrame(err);
      }
      // Throw original error if there is no codeFrame
      throw err;
    }
  }

  collectDependencies() {
    for (let dep of this.ast.stats.includedFiles) {
      this.addDependency(dep, {includedInParent: true});
    }
  }

  generate() {
    return [
      {
        type: 'css',
        value: this.ast ? this.ast.css.toString() : ''
      }
    ];
  }
}

module.exports = SASSAsset;

async function getSassRuntime(searchPath) {
  try {
    return await localRequire('node-sass', searchPath, true);
  } catch (e) {
    // If node-sass is not used locally, install dart-sass, as this causes no freezing issues
    return await localRequire('sass', searchPath);
  }
}

function sassToCodeFrame(err) {
  let error = new Error(err.message);
  error.codeFrame = err.formatted;
  error.stack = err.stack;
  error.fileName = err.file;
  error.loc = {
    line: err.line,
    column: err.column
  };
  return error;
}

// Ensures an error inherits from Error
function normalizeError(err) {
  let message = 'Unknown error';

  if (err) {
    if (err instanceof Error) {
      return err;
    }

    message = err.stack || err.message || err;
  }

  return new Error(message);
}
