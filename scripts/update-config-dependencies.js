const fs = require('fs');
const path = require('path');
const exec = require('child_process').execSync;

let packages = JSON.parse(
  exec(
    `${path.join(__dirname, '..', 'node_modules', '.bin', 'lerna')} ls --json`,
  ),
);
let packageVersions = new Map(packages.map(pkg => [pkg.name, pkg.version]));

let configsDir = path.join(__dirname, '..', 'packages', 'configs');
let configs = fs.readdirSync(configsDir);
for (let config of configs) {
  let configPkgPath = path.join(configsDir, config, 'package.json');
  let pkg = JSON.parse(fs.readFileSync(configPkgPath, 'utf8'));
  if (pkg.atlaspackDependencies) {
    for (let dep in pkg.atlaspackDependencies) {
      let version = packageVersions.get(dep);
      if (!version) {
        throw new Error(`Unknown atlaspack dependency ${dep}`);
      }

      pkg.atlaspackDependencies[dep] = version;
    }

    fs.writeFileSync(configPkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}
