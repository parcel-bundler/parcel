'use server';

import { setServerState } from "./serverState";

let likeCount = 0;

export async function like() {
  console.log('Like');
  setServerState(`Liked ${++likeCount} times!`);
  return 'Liked';
}
