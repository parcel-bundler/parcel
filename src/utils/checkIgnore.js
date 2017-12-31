const ignore = require('ignore');
const path = require('path');
const config = require('./config');
const fs = require('./fs');

async function getIgnoreFile(location) {
  let fileLocation = await config.resolve(location, ['.parcelignore']);
  let ignoreFile = '';
  if (fileLocation) ignoreFile = (await fs.readFile(fileLocation)).toString();

  return {
    content: ignore().add(ignoreFile.split('\n')),
    location: path.dirname(location)
  };
}

module.exports = async function(location) {
  let ignoreFile = await getIgnoreFile(location);

  return ignoreFile.content.ignores(
    path.relative(ignoreFile.location, location)
  );
};
