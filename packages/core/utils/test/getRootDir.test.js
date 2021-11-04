import assert from 'assert';
import getRootDir from '../src/getRootDir';
import path from 'path';

describe('getRootDir', () => {
  it('Should return the common parts if provided a file list', () => {
    const rootPath = process.cwd();
    const fileList = [
      path.join(rootPath, 'foo', 'bar'),
      path.join(rootPath, 'foo', 'bar', 'baz', 'qux'),
      path.join(rootPath, 'foo.js'),
    ];
    assert.equal(getRootDir(fileList), rootPath);
  });
  it('Should return the passsed path if its a directory', () => {
    const rootPath = process.cwd();
    assert.equal(getRootDir([rootPath]), rootPath);
  });
});
