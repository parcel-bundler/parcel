import assert from 'assert';
import {bundle, distDir, outputFS} from '@parcel/test-utils';
import path from 'path';

describe.skip('image', function() {
  it('Should be able to resize images', async () => {
    await bundle(path.join(__dirname, '/integration/image/resized.js'));

    let dirContent = await outputFS.readdir(distDir);
    console.log(dirContent);

    assert.equal(dirContent.length, 8);
  });

  it('Should be able to change image format', async () => {
    await bundle(path.join(__dirname, '/integration/image/reformat.js'));

    let dirContent = await outputFS.readdir(distDir);
    let foundExtensions = [];
    for (let i of dirContent) {
      foundExtensions.push(path.extname(i));
    }
    assert.deepStrictEqual(
      foundExtensions.sort(),
      ['.png', '.jpg', '.webp', '.tiff', '.js', '.map'].sort(),
    );
  });
});
