import vars from './dir/*.js?async';

module.exports = async function () {
  return await vars.a() + await vars.b();
};
