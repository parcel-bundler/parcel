// @flow
import type {Assets} from './assets';
import type {REPLOptions} from './options';

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

// export function hasBrowserslist(assets) {
//   const configExists = assets.some(
//     v => v.name === 'browserslist' || v.name === '.browserslistrc',
//   );
//   if (configExists) return true;

//   const pkg = assets.find(v => v.name.endsWith('package.json'));
//   try {
//     const configInPackage =
//       pkg && Boolean(JSON.parse(pkg.content).browserslist);
//     return configInPackage;
//   } catch (e) {
//     return false;
//   }
// }

// export function downloadBuffer(name, buf, mime = 'application/zip') {
//   const blob = new Blob([buf], {type: mime});
//   const el = document.createElement('a');
//   el.href = URL.createObjectURL(blob);
//   el.download = name;
//   el.click();
//   setTimeout(() => URL.revokeObjectURL(el.href), 1000);
// }

export const ctrlKey: string = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';

export function saveState(
  curPreset: string,
  options: REPLOptions,
  assets: Assets,
) {
  let data = {
    currentPreset: curPreset,
    options,
    assets: assets.map(({name, content, isEntry = false}) =>
      isEntry ? [name, content, 1] : [name, content],
    ),
  };

  window.location.hash = btoa(encodeURIComponent(JSON.stringify(data)));
}

export function loadState(): ?{|
  assets: Assets,
  options: REPLOptions,
  currentPreset: ?string,
|} {
  const hash = window.location.hash.replace(/^#/, '');

  try {
    const data = JSON.parse(decodeURIComponent(atob(hash)));
    data.assets = data.assets.map(([name, content, isEntry = false]) => ({
      name,
      content,
      isEntry: Boolean(isEntry),
    }));
    return data;
  } catch (e) {
    // eslint-disable-next-line no-console
    window.location.hash = '';
    return null;
  }
}
