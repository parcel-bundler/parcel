import Button from './Button.js';
import {setServerState} from './ServerState';

export function ResetButton({value}) {
  let reset = () => {
    'use server';
    setServerState(value);
  };

  console.log(reset.$$typeof);
  return <Button action={reset}>Reset server state</Button>;
}
