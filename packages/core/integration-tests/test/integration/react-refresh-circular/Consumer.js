import {useContext} from 'react';
import {Context} from './Provider';

// This prevents the module from being self accepting
// (not all exports are react components).
export function tmp() {}

export function Consumer() {
  return <>{String(useContext(Context))}</>;
}
