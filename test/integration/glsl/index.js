const shaders = [
  require('./local.glsl'),
  require('./local.vert'),
  require('./local.tesc'),
  require('./local.tese'),
  require('./local.geom'),
  require('./local.frag'),
  require('./local.comp'),
];

module.exports = function () {
  return shaders;
};
