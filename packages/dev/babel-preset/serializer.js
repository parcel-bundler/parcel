const readPkgUp = require('read-pkg-up');
const Path = require('path');

// This babel plugin adds a __exportSpecifier property to exported classes, so that the
// serializer can automatically save and restore objects of that type from JSON.
function serializerPlugin({types: t}) {
  return {
    visitor: {
      Class(path, state) {
        let filename = state.file.opts.filename;
        let {pkg, path: pkgPath} = readPkgUp.sync({
          cwd: Path.dirname(filename)
        });
        filename =
          pkg.name + '/' + Path.relative(Path.dirname(pkgPath), filename);
        filename = filename.replace('/src/', '/lib/');

        // If this is a named exports, the export specifier is an array of filename + export name,
        // otherwise it is just the filename for default exports.
        let exportSpecifier;
        if (path.parentPath.isExportNamedDeclaration()) {
          exportSpecifier = t.arrayExpression([
            t.stringLiteral(filename),
            t.stringLiteral(path.node.id.name)
          ]);
        } else if (path.parentPath.isExportDefaultDeclaration()) {
          exportSpecifier = t.stringLiteral(filename);
        }

        if (!exportSpecifier) {
          return;
        }

        // Add a static property to the class
        let property = t.classProperty(
          t.identifier('__exportSpecifier'),
          exportSpecifier
        );

        property.static = true;
        path.get('body').unshiftContainer('body', property);
      }
    }
  };
}

module.exports = serializerPlugin;
