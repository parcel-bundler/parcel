const fs = require('./fs');
const path = require('path');

async function countFiles(location, count = 0) {
  let stats = await fs.lstat(location);

  if (stats.isDirectory()) {
    let files = await fs.readdir(location);

    count += (await Promise.all(
      files.map(file => {
        return countFiles(path.join(location, file));
      })
    )).reduce((accumulator, currentValue) => {
      return accumulator + currentValue;
    }, 0);
  }

  return count + 1;
}

module.exports = countFiles;
