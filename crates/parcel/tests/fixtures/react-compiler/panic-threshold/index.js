import {useState} from 'react';

export function App({show}) {
  if (show) {
    useState(0);
  }
  return <div />;
}
