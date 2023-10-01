const fs = require("fs");
const path = require("path");

module.exports = function (api, { filenameMain, filenameFallback }) {
  const { types: t } = api;

  const filepathMain = path.join(__dirname, filenameMain);
  const filepathFallback = path.join(__dirname, filenameFallback);
  let contents;
  api.addExternalDependency(filepathMain);
  try {
    contents = fs.readFileSync(filepathMain, "utf8");
  } catch (e) {
    api.addExternalDependency(filepathFallback);
    contents = fs.readFileSync(filepathFallback, "utf8");
  }
  api.cache.never();

  return {
    visitor: {
      Identifier(path) {
        if (path.node.name === "REPLACE_ME") {
          path.replaceWith(t.stringLiteral(contents));
        }
      },
    },
  };
};
