// Server dependencies.
import express from 'express';
import {renderRSC} from '@parcel/rsc/node';

// Page components. These must have "use server-entry" so they are treated as code splitting entry points.
import {RSC} from './RSC';

const app = express();

app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'rsc-action');
  next();
});

app.get('/', async (req, res) => {
  // Render the server component to an RSC payload.
  // Since our app is initially client rendered, we don't need to SSR it to HTML.
  let stream = renderRSC(<RSC />);
  res.set('Content-Type', 'text/x-component');
  stream.pipe(res);
});

app.listen(3001);
console.log('Server listening on port 3001');
