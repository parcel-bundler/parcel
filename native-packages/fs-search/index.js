const binding = require(`./index.${process.platform}.node`);
const path = require('path');
const {NodeFS} = require('@parcel/fs');

exports.find_node_module = function(fs, module, from, root) {
  if (fs instanceof NodeFS) {
    return binding.find_node_module(module, from, root);
  }

  let dir = path.dirname(from);
  while (dir !== root) {
    // Skip node_modules directories
    if (path.basename(dir) === 'node_modules') {
      dir = path.dirname(dir);
    }

    try {
      let moduleDir = path.join(dir, 'node_modules', module);
      let stats = fs.statSync(moduleDir);
      if (stats.isDirectory()) {
        return moduleDir;
      }
    } catch (err) {
      // ignore
    }

    // Move up a directory
    dir = path.dirname(dir);
  }

  return null;
};

exports.find_file = function(fs, filepath, filenames, root) {
  if (fs instanceof NodeFS) {
    return binding.find_file(filepath, filenames, root);
  }

  filepath = path.dirname(filepath);

  while (filepath !== root) {
    if (path.basename(filepath) === 'node_modules') {
      return null;
    }

    for (const filename of filenames) {
      let file = path.join(filepath, filename);
      try {
        if (fs.statSync(file).isFile()) {
          return file;
        }
      } catch (err) {}
    }

    filepath = path.dirname(filepath);
  }

  return null;
};

exports.find_first_file = function(fs, names) {
  if (fs instanceof NodeFS) {
    return binding.find_first_file(names);
  }

  for (let name of names) {
    try {
      if (fs.statSync(name).isFile()) {
        return name;
      }
    } catch (err) {}
  }
};
