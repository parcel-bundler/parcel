import {bundle, assertBundles, distDir, outputFS} from '@parcel/test-utils';
import assert from 'assert';
import path from 'path';

function getPathToFile(relativePathToFile) {
  return path.join(__dirname, relativePathToFile);
}

let pathToIndex = getPathToFile('/integration/schema-jsonld/index.html');

async function getBundleFile() {
  await bundle(pathToIndex);
  let pathToOutputFile = path.join(distDir, 'index.html');
  return outputFS.readFile(pathToOutputFile, 'utf-8');
}

describe('jsonld', function() {
  it('Should parse a LD+JSON schema and collect dependencies', async function() {
    let b = await bundle(pathToIndex, {
      production: true,
      publicURL: 'https://place.holder/',
    });

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'css',
        assets: ['other.css'],
      },
      {
        type: 'html', //this is the jsonld asset
        assets: ['index.html'],
      },
      {
        type: 'png',
        assets: ['logo.png'],
      },
      {
        type: 'jpeg',
        assets: ['image.jpeg'],
      },
    ]);
  });

  it('Should output the original json back into the index.html file inside the script tag', async function() {
    let v1JSONLDOutputInsideScriptTag = {
      '@context': 'http://schema.org',
      '@type': 'LocalBusiness',
      description: 'This is your business description.',
      name: "Parcel's parcel",
      telephone: '555-111-2345',
      openingHours: 'Mo,Tu,We,Th,Fr 09:00-17:00',
      logo: {
        '@type': 'ImageObject',
        url: '/logo.75ab4307.png',
        width: 180,
        height: 120,
      },
      image: ['/image.ba250946.jpeg', '/image.ba250946.jpeg'],
    };

    let file = await getBundleFile();
    let regex = new RegExp(
      /<\s*script \s*type="application\/ld\+json"\s*>.*<\/\s*script\s*>/gm,
    );

    let matches = regex.exec(file).map(m => {
      // removes script html tags to extract the json object in between them
      return m.replace(/<\/?\s*script( \w+=".*"\s*)*\s*>/g, '');
    });

    let actual = JSON.parse(matches[0]);
    let expected = v1JSONLDOutputInsideScriptTag;

    assert.deepEqual(actual, expected);
  });
});
