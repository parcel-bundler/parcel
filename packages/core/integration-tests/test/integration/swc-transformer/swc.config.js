module.exports = {
  $schema: 'https://swc.rs/schema.json',
  jsc: {
    parser: {
      syntax: 'ecmascript',
      jsx: true,
    },
    experimental: {
      plugins: [[require.resolve('@swc/plugin-remove-console'), {}]],
    },
  },
};
