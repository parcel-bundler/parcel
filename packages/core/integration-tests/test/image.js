import assert from 'assert';
import {bundle, distDir, inputFS, outputFS} from '@parcel/test-utils';
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
      if (ext === '.jpeg') {
        imagePath = path.join(distDir, filename);
      }
    }
    assert.deepStrictEqual(
      foundExtensions.sort(),
      ['.jpeg', '.js', '.map'].sort(),
    );

    let buffer = await outputFS.readFile(imagePath);
    let image = await sharp(buffer).metadata();
    assert.equal(image.width, 600);
  });

  it('Should be able to import an image using multiple varying query parameters', async () => {
    await bundle(
      path.join(__dirname, '/integration/image-multiple-queries/index.html'),
    );

    let dirContent = await outputFS.readdir(distDir);
    let foundExtensions = [];
    for (let filename of dirContent) {
      const foundExt = path.extname(filename);
      if (foundExt !== '.map') {
        foundExtensions.push(foundExt);
      }
    }

    assert.deepStrictEqual(
      foundExtensions.sort(),
      ['.jpeg', '.jpeg', '.webp', '.html'].sort(),
    );
  });

  describe('Should be able to change image format', () => {
    function testCase(ext) {
      return async () => {
        await bundle(
          path.join(__dirname, `/integration/image/reformat.${ext}`),
        );

        let dirContent = await outputFS.readdir(distDir);
        let foundExtensions = [];
        for (let filename of dirContent) {
          const foundExt = path.extname(filename);
          if (foundExt !== '.map') {
            foundExtensions.push(foundExt);
          }
        }
        assert.deepStrictEqual(
          foundExtensions.sort(),
          ['.webp', `.${ext}`].sort(),
        );
      };
    }

    it('from JS', testCase('js'));
    it('from HTML', testCase('html'));
    it('from CSS', testCase('css'));

    it('all formats', async () => {
      let b = await bundle(
        path.join(__dirname, `/integration/image/reformat-all.html`),
      );

      let foundExtensions = new Set(b.getBundles().map(({type}) => type));

      assert.deepStrictEqual(
        foundExtensions,
        new Set(['html', 'webp', 'avif', 'jpeg', 'png', 'tiff']),
      );
    });
  });

  it('should lossless optimise JPEGs', async function() {
    let img = path.join(__dirname, '/integration/image/image.jpg');
    let b = await bundle(img, {
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    const imagePath = b.getBundles().find(b => b.type === 'jpg').filePath;

    let input = await inputFS.readFile(img);
    let inputRaw = await sharp(input)
      .toFormat('raw')
      .toBuffer();
    let output = await outputFS.readFile(imagePath);
    let outputRaw = await sharp(output)
      .toFormat('raw')
      .toBuffer();

    assert(outputRaw.equals(inputRaw));
    assert(output.length < input.length);
  });

  it('should lossless optimise PNGs', async function() {
    let img = path.join(__dirname, '/integration/image/clock.png');
    let b = await bundle(img, {
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    const imagePath = b.getBundles().find(b => b.type === 'png').filePath;

    let input = await inputFS.readFile(img);
    let inputRaw = await sharp(input)
      .toFormat('raw')
      .toBuffer();
    let output = await outputFS.readFile(imagePath);
    let outputRaw = await sharp(output)
      .toFormat('raw')
      .toBuffer();

    assert(outputRaw.equals(inputRaw));
    assert(output.length < input.length);
  });

  it('support config files for jpeg files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/image-config/image.jpg'),
      {
        defaultTargetOptions: {
          shouldOptimize: false,
        },
      },
    );

    const originalSize = 549196;

    const imagePath = b.getBundles().find(b => b.type === 'jpeg').filePath;

    const buffer = await outputFS.readFile(imagePath);
    const image = await sharp(buffer).metadata();

    assert.strictEqual(image.width, 1920);
    assert.strictEqual(image.chromaSubsampling, '4:4:4');
    assert(image.size < originalSize);
  });

  it('support config files for png files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/image-config/clock.png'),
      {
        defaultTargetOptions: {
          shouldOptimize: false,
        },
      },
    );

    const originalSize = 84435;
    const imagePath = b.getBundles().find(b => b.type === 'png').filePath;
    const buffer = await outputFS.readFile(imagePath);
    const image = await sharp(buffer).metadata();

    assert.strictEqual(image.width, 200);
    assert.strictEqual(image.paletteBitDepth, 8);
    assert(image.size < originalSize);
  });
});
