function lineCounter(string) {
  let matches = string.match(/\n/g);
  return matches ? matches.length + 1 : 1;
}

exports.lineCounter = lineCounter;
