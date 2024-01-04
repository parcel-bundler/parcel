// @flow
import JSZip from 'jszip';
import {type FSMap} from './assets';

export * from './assets';
export * from './options';

export function nthIndex(str: string, pat: string, n: number): number {
  var length = str.length,
    i = -1;
  while (n-- && i++ < length) {
    i = str.indexOf(pat, i);
    if (i < 0) break;
  }
  return i;
}

export const ctrlKey: string = navigator.platform.includes('Mac')
  ? '⌘'
  : 'Ctrl';

function downloadBlob(name: string, blob: Blob) {
  const el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = name;
  el.click();
  setTimeout(() => URL.revokeObjectURL(el.href), 1000);
}
// function downloadBuffer(name: string, buf: Uint8Array, mime: string) {
//   const blob = new Blob([buf], {type: mime});
//   downloadBlob(name, blob);
// }

export async function downloadZIP(files: Map<string, {value: string, ...}>) {
  let zip = new JSZip();

  for (let [name, {value}] of files) {
    zip.file(name, value);
  }

  let blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 5,
    },
  });

  downloadBlob('repl.zip', blob);
}

export async function extractZIP(content: ArrayBuffer): Promise<FSMap> {
  let zip = await JSZip.loadAsync(content);

  let files = (
    await Promise.all(
      Object.entries(zip.files).map(async ([relativePath, zipEntry]) => {
        // $FlowFixMe
        if (!zipEntry.dir) {
          // $FlowFixMe
          return [relativePath, {value: await zipEntry.async('string')}];
        }
      }),
    )
  ).filter(Boolean);

  let result: FSMap = new Map();
  function get(p): FSMap {
    let v = result;
    for (let e of p) {
      // $FlowFixMe
      let c = v.get(e);
      if (!c) {
        c = new Map();
        // $FlowFixMe
        v.set(e, c);
      }
      v = c;
    }
    // $FlowFixMe
    return v;
  }
  for (let [p, data] of files) {
    let pSplit = p.split('/');
    let folder = pSplit.slice(0, -1);
    let file = pSplit[pSplit.length - 1];
    get(folder).set(file, data);
  }

  return result;
}

export function linkSourceMapVisualization(
  bundle: string,
  sourcemap: string,
): string {
  let hash = Buffer.concat([
    Buffer.from(String(bundle.length)),
    Buffer.from([0]),
    Buffer.from(bundle),
    Buffer.from(String(sourcemap.length)),
    Buffer.from([0]),
    Buffer.from(sourcemap),
  ]);

  return (
    'https://evanw.github.io/source-map-visualization/#' +
    hash.toString('base64')
  );
}
