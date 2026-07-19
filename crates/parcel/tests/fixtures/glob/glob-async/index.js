import vars from './dir/*.js?async=true';

module.exports = async function () {
  return await vars.a() + await vars.b();
};
