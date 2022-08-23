const glob = require('glob');
const path = require('path');
const fs = require('fs');

const appRoot = process.cwd();

try {
  fs.accessSync(path.join(appRoot, 'yarn.lock'));
} catch (e) {
  console.error('Not a root:', appRoot);
  process.exit(1);
}

let args = process.argv.slice(2);
let parcelRoot = path.resolve(__dirname, '..');
let dryRun = args.includes('--dry');

if (args.some(a => a !== '--dry')) {
  console.error('Invalid arguments');
  console.error('Usage: node parcel-link.js [--dry]');
  process.exit(1);
}

if (dryRun) {
  console.log('Dry run...');
}

function fsDelete(f) {
  console.log('Deleting', path.join('<app>', path.relative(appRoot, f)));
  if (!dryRun) {
    fs.rmSync(f, {recursive: true});
  }
}
function fsSymlink(source, target) {
  console.log(
    'Symlink',
    source,
    '->',
    path.join('<app>', path.relative(appRoot, target)),
  );
  if (!dryRun) {
    fs.symlinkSync(source, target);
  }
}

// Step 1: Determine all Parcel packages to link
// --------------------------------------------------------------------------------

function findParcelPackages(rootDir, files = new Map()) {
  for (let file of fs.readdirSync(rootDir)) {
    if (file === 'node_modules') continue;
    let projectPath = path.join(rootDir, file);
    const stats = fs.statSync(projectPath);
    if (stats && stats.isDirectory()) {
      let packagePath = path.join(projectPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        let pack = JSON.parse(fs.readFileSync(packagePath).toString());
        if (!pack.private) {
          files.set(pack.name, projectPath);
        }
      } else {
        findParcelPackages(projectPath, files);
      }
    }
  }
  return files;
}

let parcelPackages = findParcelPackages(parcelRoot + '/packages');
let atlassianToParcelPackages = new Map();
for (let packageName of parcelPackages.keys()) {
  if (packageName.startsWith('@atlassian')) {
    continue;
  }
  atlassianToParcelPackages.set(
    packageName === 'parcel'
      ? '@atlassian/parcel'
      : packageName === 'parcelforvscode'
      ? '@atlassian/parcelforvscode'
      : packageName.replace(/^@parcel\//, '@atlassian/parcel-'),
    packageName,
  );
}

// // Step 2.1: In .parcelrc, rewrite all references to official plugins to `@parcel/*`
// // This is optional as the packages are also linked under the `@atlassian/parcel-*` name
// // --------------------------------------------------------------------------------

// console.log(('Rewriting .parcelrc'));
// let configPath = path.join(appRoot, '.parcelrc');
// let config = fs.readFileSync(configPath, 'utf8');
// fs.writeFileSync(
// 	configPath,
// 	config.replace(
// 		/"(@atlassian\/parcel-[^"]*)"/g,
// 		(_, match) => `"${atlassianToParcelPackages.get(match) ?? match}"`,
// 	),
// );

// Step 2.2: In the root package.json, rewrite all references to official plugins to @parcel/...
// For configs like "@atlassian/parcel-bundler-default":{"maxParallelRequests": 10}
// --------------------------------------------------------------------------------

console.log('Rewriting root package.json');

let rootPkgPath = path.join(appRoot, 'package.json');
let rootPkg = fs.readFileSync(rootPkgPath, 'utf8');
for (let packageName of [
  '@atlassian/parcel-bundler-default',
  '@atlassian/parcel-bundler-experimental',
  '@atlassian/parcel-transformer-css',
]) {
  rootPkg = rootPkg.replaceAll(
    packageName,
    atlassianToParcelPackages.get(packageName),
  );
}

fs.writeFileSync(rootPkgPath, rootPkg);

// Step 3: Delete all official packages (`@atlassian/parcel-*` or `@parcel/*`) from node_modules
// --------------------------------------------------------------------------------

function cleanupNodeModules(root) {
  for (let dirName of fs.readdirSync(root)) {
    let dirPath = path.join(root, dirName);
    if (dirName === '.bin') {
      let binSymlink = path.join(root, '.bin/parcel');
      try {
        fs.accessSync(binSymlink);
        // no access error, exists
        fsDelete(binSymlink);
      } catch (e) {
        // noop
      }
      continue;
    }
    if (dirName[0].startsWith('@')) {
      cleanupNodeModules(dirPath);
      continue;
    }

    let packageName;
    let parts = dirPath.split(path.sep).slice(-2);
    if (parts[0].startsWith('@')) {
      packageName = parts.join('/');
    } else {
      packageName = parts[1];
    }

    // -------

    if (
      parcelPackages.has(packageName) ||
      atlassianToParcelPackages.has(packageName)
    ) {
      fsDelete(dirPath);
    }

    // -------

    let packageNodeModules = path.join(root, dirName, 'node_modules');
    let stat;
    try {
      stat = fs.statSync(packageNodeModules);
    } catch (e) {
      // noop
    }
    if (stat?.isDirectory()) {
      cleanupNodeModules(packageNodeModules);
    }
  }
}

for (let nodeModules of [
  ...glob.sync('build-tools/*/node_modules', {cwd: appRoot}),
  ...glob.sync('build-tools/parcel/*/node_modules', {cwd: appRoot}),
  path.join(appRoot, 'node_modules'),
]) {
  cleanupNodeModules(nodeModules);
}

// Step 4: Link the Parcel packages into node_modules as both `@parcel/*` and `@atlassian/parcel-*`
// --------------------------------------------------------------------------------

for (let [packageName, p] of parcelPackages) {
  fsSymlink(p, path.join(appRoot, 'node_modules', packageName));
}
for (let [atlassianName, parcelName] of atlassianToParcelPackages) {
  let p = parcelPackages.get(parcelName);
  fsSymlink(p, path.join(appRoot, 'node_modules', atlassianName));
}

// Step 5: Point `parcel` bin symlink to linked `packages/core/parcel/src/bin.js`
// --------------------------------------------------------------------------------

fsSymlink(
  path.join(parcelRoot, 'packages/core/parcel/src/bin.js'),
  path.join(appRoot, 'node_modules/.bin/parcel'),
);

console.log('🎉 Linking successful');
