import path from "path";
import fs from "fs";

module.exports = function () {
  return [fs, path.join("app", "index.js")];
};
