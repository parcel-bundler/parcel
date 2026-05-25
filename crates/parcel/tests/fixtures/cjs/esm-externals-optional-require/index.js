let test;
try {
  require('optional');
  test = 'fail';
} catch {
  test = 'pass';
}
export default test;
