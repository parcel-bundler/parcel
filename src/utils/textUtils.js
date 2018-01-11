function lineCounter(string) {
  return string.split('\n').length;
}

function whiteSpaceLength(string, line) {
  let lineContent = string.split('\n')[line];
  let whiteSpace = lineContent ? lineContent.match(/ */g)[0] : null;
  return whiteSpace ? whiteSpace.length : 0;
}

exports.lineCounter = lineCounter;
exports.whiteSpaceLength = whiteSpaceLength;
