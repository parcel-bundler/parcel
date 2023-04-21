import React from 'react';
import {Consumer} from './Consumer';

// This prevents the module from being self accepting
// since it is not a react component.
export let Context = React.createContext(null);

export function Provider() {
  return (
    <Context.Provider value={2}>
      <Consumer />
    </Context.Provider>
  );
}
