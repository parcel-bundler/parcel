var vars = import('./dir/*.js');

module.exports = async function () {
  return await vars.a() + await vars.b();
};
