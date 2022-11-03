import * as React from 'b';

const Context = React.createContext('Hello');

export function createContext() {
  function useContext() {
    const context = React.useContext(Context);
    return context + ' World';
  }
  return [useContext];
}
