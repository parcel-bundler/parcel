'use client';

import {setServerCallback} from 'react-server-dom-parcel/client';
import {reexportedAction, starReexportedAction} from './actions';

export function Client() {
  return <p>Client</p>;
}

export function callAction() {
  return reexportedAction(2);
}

export function callStarAction() {
  return starReexportedAction(3);
}

setServerCallback(async function (id, args) {
  callback(id, args);
});

output = {callAction, callStarAction};
