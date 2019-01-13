const marked = require('marked');
const posthtmlTransform = require('../transforms/posthtml');
const api = require('posthtml/lib/api');
const HTMLAsset = require('./HTMLAsset');

class MarkdownAsset extends HTMLAsset {
  async parse(code) {
    let res = await posthtmlTransform.parse(marked(code), this);
    res.walk = api.walk;
    res.match = api.match;
    return res;
  }
}

module.exports = MarkdownAsset;
