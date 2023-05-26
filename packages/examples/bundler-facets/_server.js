const express = require('express');
const path = require('path');
const fs = require('fs');
const port = 4000;

const routes = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'dist/routes.json'), 'utf8'),
).reverse();

const htmlPrelude = `<a href="/">Home</a> <br />
<a href="/blog/">/blog/</a> <br />
<a href="/blog/1">/blog/1</a> <br />
<a href="/blog/2">/blog/2</a> <br />
<pre id="root"></pre>`;

const html = scripts =>
  htmlPrelude +
  '\n' +
  scripts.map(s => `<script type="module" src="/${s}"></script>`).join('\n');

const app = express();

app.use(express.static('dist'));

routes.forEach(({facet, bundles}) => {
  app.get(facet, (req, res) => {
    res.type('html');
    res.send(html(bundles));
  });
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
