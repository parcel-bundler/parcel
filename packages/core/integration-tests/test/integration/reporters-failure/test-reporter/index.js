const { Reporter } = require('@atlaspack/plugin');

module.exports = new Reporter({
  async report({ event }) {
    if (event.type === 'buildSuccess') {
      throw new Error('Failed to report buildSuccess');
    }
  }
});
