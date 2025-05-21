import Button from './Button.js';
import {setServerState} from './ServerState';

const foo = 'test';

export function ResetButton({value}) {
  let reset = async () => {
    'use server';
    setServerState(foo + ': ' + value);
  };

  return <Button action={reset}>Reset server state</Button>;
}
