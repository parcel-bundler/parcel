// @flow
import sliceAnsi from 'slice-ansi';
import stringWidth from 'string-width';

// Splits a string into chunks of a specified size, for displaying in the terminal using the correct size
export function splitAnsi(line: string, maxWidth: number): Array<string> {
  let lineWidth = stringWidth(line);
  if (lineWidth < maxWidth) {
    return [line];
  }

  // Cap max width at 1 if it's 0 or smaller
  maxWidth = maxWidth > 1 ? maxWidth : 1;
  let amountOfChunks = Math.ceil(lineWidth / maxWidth);
  let chunks: Array<string> = new Array(amountOfChunks).fill('');
  for (let i = 0; i < amountOfChunks; i++) {
    let offset = i * maxWidth;
    chunks[i] = sliceAnsi(line, offset, offset + maxWidth);
  }
  return chunks;
}
