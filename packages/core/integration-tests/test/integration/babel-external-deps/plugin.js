const fs = require("fs");
const path = require("path");

module.exports = function (api, { filename }) {
  const { types: t } = api;

  const filepath = path.join(__dirname, filename);
  const contents = fs.readFileSync(filepath, "utf8");
  api.cache.never();
  api.addExternalDependency(filepath);

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
