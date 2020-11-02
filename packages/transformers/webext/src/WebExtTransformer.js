// @flow

import type {MutableAsset} from '@parcel/types';
import {Transformer} from '@parcel/plugin';
import {join, extname, dirname, relative} from 'path';
import {parse} from 'json-source-map';
import {validateSchema} from '@parcel/utils';
import ThrowableDiagnostic, {getJSONSourceLocation} from '@parcel/diagnostic';
import {glob} from '@parcel/utils';
import type {DiagnosticCodeHighlight} from '@parcel/diagnostic';
import WebExtSchema from './schema';

const BASE_KEYS = ['manifest_version', 'name', 'version'];

const DEP_LOCS = [
  ['icons'],
  ['browser_action', 'default_icon'],
  ['browser_action', 'default_popup', true],
  ['browser_action', 'theme_actions', 'light'],
  ['browser_action', 'theme_actions', 'dark'],
  ['page_action', 'default_icon'],
  ['page_action', 'default_popup', true],
  ['background', 'scripts', true],
  ['chrome_url_overrides'],
  ['devtools_page', true],
  ['options_ui', 'page', true],
  ['sidebar_action', 'default_icon'],
  ['sidebar_action', 'default_panel', true],
  ['storage', 'managed_schema'],
  ['theme', 'images', 'theme_frame'],
  ['theme', 'images', 'additional_backgrounds'],
  ['user_scripts', 'api_script', true],
];

async function collectDependencies(
  asset: MutableAsset,
  program: any,
  ptrs: {[key: string]: any, ...},
) {
  // isEntry used whenever strictly necessary to preserve filename
  // also for globs because it's wasteful to write out every file name
  const fs = asset.fs;
  const filePath = asset.filePath;
  if (program.default_locale) {
    const locales = join(dirname(filePath), '_locales');
    let err = !(await fs.exists(locales))
      ? 'key'
      : !(await fs.exists(join(locales, program.default_locale)))
      ? 'value'
      : null;
    if (err) {
      throw new ThrowableDiagnostic({
        diagnostic: [
          {
            message:
              'Localization directory' +
              (err == 'value' ? ' for ' + program.default_locale : '') +
              ' does not exist',
            origin: '@parcel/transformer-webext',
            filePath,
            codeFrame: {
              codeHighlights: [
                ((getJSONSourceLocation(
                  ptrs['/default_locale'],
                  err,
                ): any): DiagnosticCodeHighlight),
              ],
            },
          },
        ],
      });
    }
    for (const locale of await fs.readdir(locales)) {
      asset.addURLDependency(join('raw:_locales', locale, 'messages.json'), {
        isEntry: true,
      });
    }
  }
  if (program.content_scripts) {
    for (let i = 0; i < program.content_scripts.length; ++i) {
      const sc = program.content_scripts[i];
      for (const k of ['css', 'js']) {
        const assets = sc[k] || [];
        for (let j = 0; j < assets.length; ++j) {
          assets[j] = asset.addURLDependency(assets[j], {
            isEntry: k == 'js',
            loc: {
              filePath,
              ...getJSONSourceLocation(
                ptrs[`/content_scripts/${i}/${k}/${j}`],
                'value',
              ),
            },
          });
        }
      }
    }
  }
  if (program.dictionaries) {
    for (const dict in program.dictionaries) {
      const sourceLoc = getJSONSourceLocation(
        ptrs[`/dictionaries/${dict}`],
        'value',
      );
      const loc = {
        filePath,
        ...sourceLoc,
      };
      const dictFile = program.dictionaries[dict];
      if (extname(dictFile) != '.dic') {
        throw new ThrowableDiagnostic({
          diagnostic: [
            {
              message: 'Dictionaries must be .dic files',
              origin: '@parcel/transformer-webext',
              filePath,
              codeFrame: {
                codeHighlights: [((sourceLoc: any): DiagnosticCodeHighlight)],
              },
            },
          ],
        });
      }
      program.dictionaries[dict] = asset.addURLDependency(dictFile, {
        isEntry: true,
        loc,
      });
      asset.addURLDependency(dictFile.slice(0, -4) + '.aff', {
        isEntry: true,
        loc,
      });
    }
  }
  if (program.web_accessible_resources) {
    for (let i = 0; i < program.web_accessible_resources.length; ++i) {
      // TODO: this doesn't support Parcel resolution
      const globQuery = join(
        dirname(filePath),
        program.web_accessible_resources[i],
      );
      for (const fp of await glob(globQuery, fs, {})) {
        asset.addURLDependency(relative(dirname(filePath), fp), {
          isEntry: true,
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[`/web_accessible_resources/${i}`]),
          },
        });
      }
    }
  }
  for (let loc of DEP_LOCS) {
    let isEntry: boolean = false;
    if (typeof loc[loc.length - 1] == 'boolean') {
      isEntry = ((loc[loc.length - 1]: any): boolean);
      loc = loc.slice(0, -1);
    }
    const locStr = '/' + loc.join('/');
    let obj: any = program;
    for (let i = 0; i < loc.length - 1; ++i) {
      obj = obj[loc[i]];
      if (!obj) break;
    }
    if (!obj) continue;
    const parent = obj,
      lloc = loc[loc.length - 1];
    obj = obj[lloc];
    if (!obj) continue;
    if (typeof obj == 'string')
      parent[lloc] = asset.addURLDependency(
        // TODO: not this, for sure
        (extname(obj) == '.json' ? 'raw:' : '') + obj,
        {
          isEntry,
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[locStr], 'value'),
          },
        },
      );
    else {
      for (const k of Object.keys(obj)) {
        obj[k] = asset.addURLDependency(
          (extname(obj[k]) == '.json' ? 'raw:' : '') + obj[k],
          {
            isEntry,
            loc: {
              filePath,
              ...getJSONSourceLocation(ptrs[locStr + '/' + k], 'value'),
            },
          },
        );
      }
    }
  }
}

export default (new Transformer({
  async parse({asset}) {
    const code = await asset.getCode();
    const map = parse(code);
    if (BASE_KEYS.some(key => !map.data.hasOwnProperty(key))) {
      // This is probably just another file that happens to be named manifest.json
      return null;
    }
    validateSchema.diagnostic(
      WebExtSchema,
      {
        data: map.data,
        source: code,
        filePath: asset.filePath,
      },
      '@parcel/transformer-webext',
      'Invalid Web Extension manifest',
    );
    return {
      type: 'json-source-map',
      version: '0.6.1',
      program: map,
    };
  },
  async transform({asset}) {
    const ast = await asset.getAST();
    if (!ast) return [asset];
    const {data, pointers} = ast.program;
    await collectDependencies(asset, data, pointers);
    asset.meta.handled = true;
    asset.setCode(JSON.stringify(data));
    return [asset];
  },
}): Transformer);
