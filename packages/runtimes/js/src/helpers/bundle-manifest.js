var mapping = new Map();
var conditions = new Map();
function register(baseUrl, manifest) {
  for (var i = 0; i < manifest.length - 1; i += 2) {
    mapping.set(manifest[i], {
      baseUrl: baseUrl,
      path: manifest[i + 1],
    });
  }
}

function resolve(id) {
  var resolved = mapping.get(id);
  if (resolved == null) {
    throw new Error('Could not resolve bundle with id ' + id);
  }
  return new URL(resolved.path, resolved.baseUrl).toString();
}

function registerConditions(conditions) {
  for (const [k, v] of Object.entries(conditions)) {
    conditions.set(k, v);
  }
}

module.exports.register = register;
module.exports.resolve = resolve;
module.exports.registerConditions = registerConditions;
