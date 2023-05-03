/* eslint-disable no-console */
// @flow

// toxiproxy-cli delete cache_server && toxiproxy-cli create -l 0.0.0.0:2392 -u 127.0.0.1:23921 cache_server && toxiproxy-cli toxic add -t latency -a latency=20 cache_server && toxiproxy-cli toxic add -t bandwidth -a rate=10000 cache_server

const path = require('path');
const fs = require('fs');
const express = require('express');
// const fresh = require('fresh');
const lmdb = require('lmdb');

const PORT = Number(process.env.PORT ?? 2392);

const store = lmdb.open('.parcel-cache', {
  name: 'parcel-cache',
  encoding: 'binary',
  compression: true,
});

const snapshotKey = fs
  .readdirSync('.parcel-cache')
  .filter(f => f.endsWith('.txt'))[0]
  .split('.')[0];
const snapshot = fs.readFileSync(
  path.join('.parcel-cache', snapshotKey + '.txt'),
);

let app = express();
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST');
  next();
});

fs.mkdirSync(path.join(__dirname, 'data'), {recursive: true});

app.head('/:key', async (req, res) => {
  let key = req.params.key;
  console.log('HEAD', key);

  let exists = store.doesExist(key) || key === snapshot;
  if (!exists) {
    try {
      await fs.promises.stat(path.join('.parcel-cache', key));
      exists = true;
    } catch (e) {
      /*noop*/
    }
  }

  if (exists) {
    res.set('Content-Type', 'application/octet-stream');
    res.status(200).send();
  } else {
    res.status(404).send();
  }
});

app.get('/:key', async (req, res) => {
  let key = req.params.key;
  console.log('GET', key);

  let data;
  if (key === snapshotKey) {
    data = snapshot;
  } else {
    data = store.get(key);
    if (!data) {
      try {
        data = await fs.promises.readFile(path.join('.parcel-cache', key));
      } catch (e) {
        /*noop*/
      }
    }
  }

  // if (fresh(req.headers, {'last-modified': stat.mtime.toUTCString()})) {
  //   res.statusCode = 304;
  //   res.end();
  //   return;
  // }

  if (!data) {
    res.status(404);
    res.end();
  } else {
    res.set('Content-Type', 'application/octet-stream');
    res.status(200);
    res.end(data);
  }
  3;
});

// app.post('/:key', (req, res) => {
//   let key = req.params.key;
//   console.log('POST', key);
//   req.pipe(fs.createWriteStream(path.join(__dirname, 'data', key)));
//   req.on('end', () => {
//     res.end();
//   });
// });

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
