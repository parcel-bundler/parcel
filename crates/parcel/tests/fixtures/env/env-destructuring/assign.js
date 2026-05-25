let test = 'test';
let env, NODE_ENV, renamed, computed, fallback, rest, result;
env = process.env;
result = ({NODE_ENV, TEST: renamed, [test]: computed, fallback = 'yo', ...rest} = process.env);
module.exports = {
  env,
  NODE_ENV,
  renamed,
  computed,
  fallback,
  rest,
  result,
};
