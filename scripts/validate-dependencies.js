/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const semver = require('semver');

/** The set of packages to exclude from validation. */
const PACKAGE_EXCLUDES = new Set([]);

/** The set of dependencies to ignore when validating. */
const DEPENDENCY_EXCLUDES = new Set([]);

/** A map of package.json fields to descriptors for error formatting. */
const DEPENDENCY_TYPES = new Map([
  ['dependencies', 'dependency'],
  ['devDependencies', 'dev dependency'],
  ['peerDependencies', 'peer dependency'],
  ['optionalDependencies', 'optional dependency'],
  ['parcelDependencies', 'parcel dependency'],
]);

/**
 * A package lists a dependency that is incompatible
 * with a version of the same dependency in at least one other package.
 */
class DependencyMismatchError extends Error {
  name = 'DependencyMismatchError';
  constructor(name, expr, dependent, otherExpr, otherDependent) {
    super(
      `${dependent.name} has a ${DEPENDENCY_TYPES.get(
        dependent.type,
      )} "${name}@${expr}" that is incompatible with a ${DEPENDENCY_TYPES.get(
        otherDependent.type,
      )} "${name}@${otherExpr}" from ${otherDependent.name}`,
    );
  }
}

/**
 * A package lists another parcel package as a dependency
 * that is incompatible with the current version of that package.
 */
class PackageMismatchError extends Error {
  name = 'PackageMismatchError';
  constructor(name, expr, dependent, version) {
    super(
      `${dependent.name} has a ${DEPENDENCY_TYPES.get(
        dependent.type,
      )} "${name}@${expr}" that is incompatible with the current version "${name}@${version}".`,
    );
  }
}

let lerna = path.join(__dirname, '..', 'node_modules', '.bin', 'lerna');
let workspaces = JSON.parse(
  childProcess.execSync(`${lerna} ls --all --json --loglevel error`),
);

let packages = new Map(
  workspaces.map(workspace => [
    workspace.name,
    JSON.parse(
      fs.readFileSync(path.join(workspace.location, 'package.json'), 'utf8'),
    ),
  ]),
);

/**
 * A map of dependency names to maps of semver expressions to
 * lists of dependent packages.
 *
 * @example
 *   Map {
 *     '@babel/core' => Map {
 *       '^7.12.0' => [
 *         {name: '@parcel/transformer-js', type: 'dependencies'},
 *         {name: '@parcel/babel-preset-env', type: 'devDependencies'},
 *         {name: '@parcel/babel-preset-env', type: 'peerDependencies'}
 *       ],
 *       '^7.12.2' => [
 *         {name: '@parcel/resolver-default', type: 'devDependencies'}
 *       ]
 *     }
 *   }
 */
let dependencyMap = new Map();
for (let [name, meta] of packages.entries()) {
  if (PACKAGE_EXCLUDES.has(name)) continue;
  for (let type of DEPENDENCY_TYPES.keys()) {
    let dependencies = meta[type];
    if (dependencies) {
      for (let [dependencyName, semver] of Object.entries(dependencies)) {
        if (DEPENDENCY_EXCLUDES.has(dependencyName)) continue;
        let dependentsMap = dependencyMap.get(dependencyName) || new Map();
        dependencyMap.set(dependencyName, dependentsMap);
        let dependents = dependentsMap.get(semver) || [];
        dependentsMap.set(semver, dependents);
        dependents.push({name, type});
      }
    }
  }
}

/**
 * Validation errors are pushed here instead of being thrown.
 * After all packages have been examined, if there were any errors,
 * the errors will be printed to stderr and the process will exit
 * with a non-zero status code.
 */
let errors = [];

function reportVersionMismatch(
  name,
  expr,
  dependents,
  otherExpr,
  otherDependents,
) {
  for (let dependent of dependents) {
    for (let otherDependent of otherDependents) {
      errors.push(
        new DependencyMismatchError(
          name,
          expr,
          dependent,
          otherExpr,
          otherDependent,
        ),
      );
    }
  }
}

function reportParcelVersionMismatch(name, expr, dependents, version) {
  for (let dependent of dependents) {
    errors.push(new PackageMismatchError(name, expr, dependent, version));
  }
}

function validateSemverExpressions(name, dependentsMap) {
  let [expr, ...otherExprs] = [...dependentsMap.keys()];
  while (otherExprs.length) {
    let dependents = dependentsMap.get(expr);
    for (let otherExpr of otherExprs) {
      if (!semver.intersects(expr, otherExpr)) {
        reportVersionMismatch(
          name,
          expr,
          dependents,
          otherExpr,
          dependentsMap.get(otherExpr),
        );
      }
    }
    [expr, ...otherExprs] = otherExprs;
  }
}

function validateParcelPackageVersions(name, dependentsMap) {
  let version = packages.get(name).version;
  for (let expr of dependentsMap.keys()) {
    if (!semver.satisfies(version, expr)) {
      reportParcelVersionMismatch(name, expr, dependentsMap.get(expr), version);
    }
  }
}

/** main */
for (let [name, dependentsMap] of dependencyMap.entries()) {
  if (packages.has(name)) {
    validateParcelPackageVersions(name, dependentsMap);
  } else {
    validateSemverExpressions(name, dependentsMap);
  }
}

if (errors) {
  errors.forEach(({name, message}) => console.error(`${name}: ${message}\n`));
  console.error(`Found ${errors.length} errors.`);
  process.exit(1);
}
