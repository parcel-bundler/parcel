import {Client} from './client';
import {loadServerAction} from 'react-server-dom-parcel/server.edge';

function Server() {
  return <Client />;
}

async function runAction(id, args) {
  let action = await loadServerAction(id);
  return action(...args);
}

output = {Server, runAction};
