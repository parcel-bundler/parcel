'use client';
import {setServerCallback} from 'react-server-dom-parcel/client';
import {action} from './actions';
export function Client() {
  return <p>Client</p>;
}
export function callAction() {
  action(2);
}

setServerCallback(async function (id, args) {
  callback(id, args);
});
output = {callAction};
