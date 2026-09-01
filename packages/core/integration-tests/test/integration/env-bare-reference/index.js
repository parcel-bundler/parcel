const debug =
  process.env &&
  process.env.NODE_DEBUG &&
  /\bsemver\b/i.test(process.env.NODE_DEBUG);

module.exports = {
  debug,
  hasEnv: !!process.env,
};
