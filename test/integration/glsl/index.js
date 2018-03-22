const shaders = [
  require('./local.glsl'),
  require('./local.vert'),
  require('./local.frag'),
];

module.exports = function () {
  return shaders;
};
