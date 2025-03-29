'use server';

export let likeCount = 0;

export async function like() {
  likeCount++;
  return likeCount;
}
