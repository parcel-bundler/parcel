function lineCounter(string) {
  let lines = 1;
  for (let i = 0; i < string.length; i++) {
    if (string.charAt(i) === '\n') {
      lines++;
    }
  }

  return lines;
}

module.exports = lineCounter;
