const coffee = require('coffeescript');

export function transform(asset) {
  let content = asset.text();
  console.log(asset)
  let output = coffee.compile(content, {
    filename: asset.filePath,
    sourceMap: false,
  });

  asset.setText(output);
  asset.type = 'js';
}
