/* eslint-disable no-console */
// @flow

const path = require('path');
const fs = require('fs');
const express = require('express');
const fresh = require('fresh');

const PORT = 2392;

let app = express();
app.use(function (req /*: express$Request*/, res /*: express$Response*/, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST');
  next();
});

fs.mkdirSync(path.join(__dirname, 'data'), {recursive: true});

app.head('/:key', async (req, res) => {
  let key = req.params.key;
  console.log('HEAD', key);
  try {
    await fs.promises.stat(path.join(__dirname, 'data', key));
    res.set('Content-Type', 'application/octet-stream');
    res.status(200).send();
  } catch (e) {
    res.status(404).send();
  }
});

app.get('/:key', async (req, res) => {
  let key = req.params.key;
  console.log('GET', key);

  let p = path.join(__dirname, 'data', key);

  let stat;
  try {
    stat = await fs.promises.stat(p);
  } catch (e) {
    res.statusCode = 404;
    res.end();
    return;
  }

  if (fresh(req.headers, {'last-modified': stat.mtime.toUTCString()})) {
    res.statusCode = 304;
    res.end();
    return;
  }

  let contents = fs.createReadStream(p);
  res.set('Content-Type', 'application/octet-stream');
  res.status(200);
  contents.on('data', data => {
    res.write(data);
  });
  contents.on('error', err => {
    if (err.code == 'ENOENT') {
      res.status(404).send();
    } else {
      console.log(err);
      res.status(500).send();
    }
  });
  contents.on('end', () => {
    res.status(200).send();
  });
});

app.post('/:key', (req, res) => {
  let key = req.params.key;
  console.log('POST', key);
  req.pipe(fs.createWriteStream(path.join(__dirname, 'data', key)));
  req.on('end', () => {
    res.end();
  });
});

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
