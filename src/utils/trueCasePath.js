const glob = require('glob');
const path = require('path');

// Async version of https://github.com/barsh/true-case-path
function trueCase(fsPath) {
  // Normalize the path so as to resolve . and .. components.
  // !! As of Node v4.1.1, a path starting with ../ is NOT resolved relative
  // !! to the current dir, and glob.sync() below then fails.
  // !! When in doubt, resolve with fs.realPathSync() *beforehand*.
  let fsPathNormalized = path.normalize(fsPath);

  // OSX: HFS+ stores filenames in NFD (decomposed normal form) Unicode format,
  // so we must ensure that the input path is in that format first.
  if (process.platform === 'darwin')
    fsPathNormalized = fsPathNormalized.normalize('NFD');

  // !! Windows: Curiously, the drive component mustn't be part of a glob,
  // !! otherwise glob.sync() will invariably match nothing.
  // !! Thus, we remove the drive component and instead pass it in as the 'cwd'
  // !! (working dir.) property below.
  let pathRoot = path.parse(fsPathNormalized).root;
  let noDrivePath = fsPathNormalized.slice(Math.max(pathRoot.length - 1, 0));

  // Perform case-insensitive globbing (on Windows, relative to the drive /
  // network share) and return the 1st match, if any.
  // Fortunately, glob() with nocase case-corrects the input even if it is
  // a *literal* path.
  return new Promise((resolve, reject) =>
    glob(
      noDrivePath,
      {
        nocase: true,
        cwd: pathRoot
      },
      (err, matches) => {
        if (err) {
          reject(err);
        } else {
          resolve(matches[0]);
        }
      }
    )
  );
}

module.exports = trueCase;
