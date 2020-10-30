// @flow

import type {MutableAsset} from '@parcel/types';
import {Transformer} from '@parcel/plugin';
import {join, extname, basename, dirname} from 'path';
import {parse} from 'json-source-map';
import {validateSchema} from '@parcel/utils';
import ThrowableDiagnostic, {
  encodeJSONKeyComponent,
  getJSONSourceLocation
} from '@parcel/diagnostic';
import {glob} from '@parcel/utils';
import type {DiagnosticCodeHighlight} from '@parcel/diagnostic'
import WebExtSchema from './schema';

const BASE_KEYS = ['manifest_version', 'name', 'version'];

const DEP_LOCS = [
  ['icons'],
  ['browser_action', 'default_icon'],
  ['browser_action', 'default_popup'],
  ['browser_action', 'theme_actions', 'light'],
  ['browser_action', 'theme_actions', 'dark'],
  ['page_action', 'default_icon'],
  ['page_action', 'default_popup'],
  ['background', 'scripts'],
  ['chrome_url_overrides'],
  ['devtools_page'],
  ['options_ui', 'page'],
  ['sidebar_action', 'default_icon'],
  ['sidebar_action', 'default_panel'],
  ['storage', 'managed_schema'],
  ['theme', 'images', 'theme_frame'],
  ['theme', 'images', 'additional_backgrounds'],
  ['user_scripts', 'api_script']
];

async function collectDependencies(
  asset: MutableAsset,
  program: any,
  ptrs: {[key: string]: any, ...}
) {
  const fs = asset.fs;
  const filePath = asset.filePath;
  if (program.default_locale) {
    const locales = join(filePath, '_locales');
    let err = !(await fs.exists(locales))
      ? 'key'
      : !(await fs.exists(join(locales, program.default_locale)))
        ? 'value'
        : null;
    if (err) {
      throw new ThrowableDiagnostic({
        diagnostic: [{
          message: 'Localization directory' +
            (err == 'value' ? (' for' + program.default_locale) : '') +
            ' does not exist',
          origin: '@parcel/transformer-webext',
          filePath,
          codeFrame: {
            codeHighlights: [((
              getJSONSourceLocation(ptrs['/default_locale'], err): any
            ): DiagnosticCodeHighlight)]
          }
        }]
      });
    }
    for (const k in (await fs.readdir(locales))) {
      asset.addDependency({
        moduleSpecifier: join(locales, k, 'messages.json'),
        isEntry: true
      });
    }
  }
  if (program.content_scripts) {
    for (let i = 0; i < program.content_scripts.length; ++i) {
      const sc = program.content_scripts[i];
      for (const k of ['css', 'js']) {
        const assets = sc[k] || [];
        for (let j = 0; j < assets.length; ++j) {
          asset.addDependency({
            moduleSpecifier: assets[j],
            loc: {
              filePath,
              ...getJSONSourceLocation(
                ptrs[`/content_scripts/${i}/${k}/${j}`],
                'value'
              )
            }
          })
        }
      }
    }
  }
  if (program.dictionaries) {
    for (const dict in program.dictionaries) {
      const sourceLoc = getJSONSourceLocation(
        ptrs[`/dictionaries/${dict}`],
        'value'
      );
      const loc = {
        filePath,
        ...sourceLoc
      };
      const dictFile = program.dictionaries[dict];
      if (extname(dictFile) != '.dic') {
        throw new ThrowableDiagnostic({
          diagnostic: [{
            message: 'Dictionaries must be .dic files',
            origin: '@parcel/transformer-webext',
            filePath,
            codeFrame: {
              codeHighlights: [((
                sourceLoc: any
              ): DiagnosticCodeHighlight)]
            }
          }]
        })
      }
      asset.addDependency({
        moduleSpecifier: dictFile,
        loc
      });
      asset.addDependency({
        moduleSpecifier: basename(dictFile, '.dic') + '.aff',
        loc
      });
    }
  }
  if (program.web_accessible_resources) {
    for (let i = 0; i < program.web_accessible_resources.length; ++i) {
      // TODO: this doesn't support Parcel resolution
      const globQuery = join(
        dirname(filePath),
        program.web_accessible_resources[i]
      );
      for (const fp of await glob(globQuery, fs, {})) {
        asset.addDependency({
          moduleSpecifier: fp,
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[`/web_accessible_resources/${i}`])
          }
        });
      }
    }
  }
  for (const loc of DEP_LOCS) {
    const locStr = '/' + loc.join('/');
    let obj = program;
    for (let i = 0; i < loc.length; ++i) {
      obj = obj[loc[i]];
      if (!obj) return;
    }
    if (typeof obj == 'string') asset.addDependency({
      moduleSpecifier: obj,
      loc: {
        filePath,
        ...getJSONSourceLocation(ptrs[locStr], 'value')
      }
    });
    else {
      for (const k of Object.keys(obj)) {
        asset.addDependency({
          moduleSpecifier: obj[k],
          loc: {
            filePath,
            ...getJSONSourceLocation(ptrs[locStr + '/' + k], 'value')
          }
        });
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
        prependKey: `/${encodeJSONKeyComponent('@parcel/transformer-webext')}`
      },
      '@parcel/transformer-webext',
      'Invalid Web Extension manifest'
    );
    return {
      type: 'json-source-map',
      version: '0.6.1',
      program: map
    }
  },
  async transform({asset}) {
    const ast = await asset.getAST();
    if (!ast) return [asset];
    const {data, pointers} = ast.program;
    await collectDependencies(asset, ast.program, pointers);
    asset.meta.handled = true;
    return [asset];
  },
}): Transformer);
