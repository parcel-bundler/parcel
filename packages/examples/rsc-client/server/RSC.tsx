"use server-entry";

import {Counter} from './Counter';
import './RSC.css';

export async function RSC() {
  return (
    <div className="rsc">
      <h2>RSC!</h2>
      <Counter />
    </div>
  );
}
