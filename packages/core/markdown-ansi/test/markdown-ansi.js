import assert from 'assert';

import mdAnsi from '../src/markdown-ansi';

describe('markdown-ansi', () => {
  it('should support asteriks for bold and italic', () => {
    let res = mdAnsi('**bold** *italic*');
    assert.equal(res, '\u001b[1mbold\u001b[22m \u001b[3mitalic\u001b[23m');
  });

  it('should support underscores for underlined and italic', () => {
    let res = mdAnsi('__underline__ _italic_');
    assert.equal(res, '\u001b[4munderline\u001b[24m \u001b[3mitalic\u001b[23m');
  });

  it('should support combination of bold and underline', () => {
    let res = mdAnsi('**bold _italic_**');
    assert.equal(res, '\u001b[1mbold \u001b[3mitalic\u001b[23m\u001b[22m');
  });

  it('should support strikethrough', () => {
    let res = mdAnsi('~~strikethrough~~');
    assert.equal(res, '\u001b[9mstrikethrough\u001b[29m');
  });
});
