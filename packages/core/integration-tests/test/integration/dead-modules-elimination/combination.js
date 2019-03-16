module.exports = (() => {
  let ret = [];
  if (process.env.NODE_ENV === 'test') {
    ret.push(require('./dep1'));
  } else {
    ret.push(require('./dep2'));
  }

  if (process.env.NODE_ENV === 'test') {
    ret.push(require('./dep1'));
  }

  if (process.env.NODE_ENV === 'NOPE') {
    ret.push(require('./dep2'));
  }

  if (process.env.NODE_ENV !== 'NOPE') {
    ret.push(require('./dep1'));
  }

  if (process.env.NODE_ENV !== 'test') {
    ret.push(require('./dep2'));
  }

  ret.push(
    process.env.NODE_ENV !== 'test' ? require('./dep2') : require('./dep1')
  );

  if (process.browser) {
    return `browser:${ret.join(',')}`;
  }
  return `nobrowser:${ret.join(',')}`;
})();
