import assert from 'assert';
import {bundle, distDir, outputFS} from '@parcel/test-utils';
import path from 'path';
import sharp from 'sharp';

describe('image', function() {
  this.timeout(10000);

  it('Should be able to resize images', async () => {
    await bundle(path.join(__dirname, '/integration/image/resized.js'));

    let dirContent = await outputFS.readdir(distDir);
    let imagePath = '';
    let foundExtensions = [];
    for (let filename of dirContent) {
      let ext = path.extname(filename);
      foundExtensions.push(ext);
      if (ext === '.jpg') {
        imagePath = path.join(distDir, filename);
      }
    }
    assert.deepStrictEqual(
      foundExtensions.sort(),
      ['.jpg', '.js', '.map'].sort(),
    );

    let buffer = await outputFS.readFile(imagePath);
    let image = await sharp(buffer).metadata();
    assert.equal(image.width, 600);
  });

  it('Should be able to change image format', async () => {
    await bundle(path.join(__dirname, '/integration/image/reformat.js'));

    let dirContent = await outputFS.readdir(distDir);
    let foundExtensions = [];
    for (let filename of dirContent) {
      foundExtensions.push(path.extname(filename));
    }
    assert.deepStrictEqual(
      foundExtensions.sort(),
      ['.webp', '.js', '.map'].sort(),
    );
  });
});
