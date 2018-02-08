let options = {
  locals: { youAreUsingPug: true }
};
options.filters = {
  'my-own-filter': function (text, options) {
    if (options.addStart) text = 'Start\n' + text;
    if (options.addEnd)   text = text + '\nEnd';
    return text;
  }
};
module.exports = options;
