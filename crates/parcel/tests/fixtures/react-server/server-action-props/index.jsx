import {Client} from './client';
import {action} from './actions';
import {loadServerAction} from 'react-server-dom-parcel/server.edge';
function Server() {
  return <Client action={action} />;
}

function callActionDirectly() {
  return action(2);
}

async function runAction(id, args) {
  let action = await loadServerAction(id);
  return action(...args);
}
output = {Server, callActionDirectly, runAction};
