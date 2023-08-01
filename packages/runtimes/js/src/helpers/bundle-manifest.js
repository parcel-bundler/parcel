var mapping = new Map();

function register(baseUrl, pairs) {
  for (var i = 0; i < pairs.length; i++) {
    mapping.set(pairs[i][0], {baseUrl, path: pairs[i][1]});
  }
}

function resolve(id) {
  var resolved = mapping.get(id);
  if (resolved == null) {
    throw new Error('Could not resolve bundle with id ' + id);
  }
  return new URL(resolved.path, resolved.baseUrl).toString();
}

module.exports.register = register;
module.exports.resolve = resolve;
