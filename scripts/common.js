/* eslint-disable no-console */
const fs = require('fs');
const np = require('path');
const child_process = require('child_process');

/**
 * Returns an object where
 *  key = path to project root
 *  value = parsed package.json
 */
exports.findProjects = function findProjects(rootDir, files = {}) {
  for (let file of fs.readdirSync(rootDir)) {
    let projectPath = np.join(rootDir, file);
    const stats = fs.statSync(projectPath);
    if (stats && stats.isDirectory()) {
      let packagePath = np.join(projectPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        let pack = JSON.parse(fs.readFileSync(packagePath).toString());
        files[projectPath] = pack;
      } else {
        findProjects(projectPath, files);
      }
    }
  }

  return files;
};

/**
 * Executes a command synchronously in the specified directory.
 */
exports.exec = function exec(command, cwd) {
  try {
    console.log(`${cwd} ${command}`);
    child_process.execSync(command, {cwd});
  } catch (e) {
    console.log(e.toString().slice(0, 50));
  }
};
