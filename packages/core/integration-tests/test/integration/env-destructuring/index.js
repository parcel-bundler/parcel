let test = 'test';
let env = process.env;
let {NODE_ENV, TEST: renamed, [test]: computed, fallback = 'yo', ...rest} = process.env, other = 'hi';
module.exports = {
  env,
  NODE_ENV,
  renamed,
  computed,
  fallback,
  rest,
  other
};
