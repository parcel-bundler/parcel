module.exports = function() {
  let ret = [];
  if (process.env.NODE_ENV === 'test') {
    ret.push('truthy');
  } else {
    ret.push('falsy');
  }
  if (process.browser) {
    ret.push('truthy');
  } else {
    ret.push('falsy');
  }
  if (process.env.NODE_ENV !== 'test') {
    ret.push('falsy');
  } else {
    ret.push('truthy');
  }
  if (process.browser) {
    ret.push('truthy');
  } else {
    ret.push('falsy');
  }

  // should not be removed
  if (true) {
    const a = process.env.NODE_ENV
    if (a === 'test') {
      ret.push('truthy')
    }
  }
  ret.push(process.browser ? 'truthy' : 'falsy');
  ret.push(!process.browser ? 'falsy' : 'truthy');
  ret.push(process.env.NODE_ENV === 'test' ? 'truthy' : 'falsy');
  ret.push(process.env.NODE_ENV !== 'test' ? 'falsy' : 'truthy');
  return ret.join(':');
};
