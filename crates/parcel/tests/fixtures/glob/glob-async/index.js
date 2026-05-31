var vars = import('./dir/*.js');

module.exports = async function () {
  let v = await vars; // TODO
  return await v.a() + await v.b();
};
