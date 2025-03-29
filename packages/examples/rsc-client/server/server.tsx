// Server dependencies.
import express from 'express';
import cors from 'cors';
import {renderRSC, callAction} from '@parcel/rsc/node';

// Page components. These must have "use server-entry" so they are treated as code splitting entry points.
import {RSC} from './RSC';

const app = express();
app.use(cors());

app.get('/', async (req, res) => {
  // Render the server component to an RSC payload.
  // Since our app is initially client rendered, we don't need to SSR it to HTML.
  let stream = renderRSC(<RSC />);
  res.set('Content-Type', 'text/x-component');
  stream.pipe(res);
});

app.post('/action', async (req, res) => {
  let id = req.get('rsc-action-id');
  let {result} = await callAction(req, id);
  let stream = renderRSC(result);
  res.set('Content-Type', 'text/x-component');
  stream.pipe(res);
});

app.listen(3001);
console.log('Server listening on port 3001');
