module.exports = {
  filters: {
    'custom-filter': function (text, options) {
      return 'FILTERED: ' + text;
    }
  }
}
