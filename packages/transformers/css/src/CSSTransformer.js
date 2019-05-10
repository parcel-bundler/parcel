// @flow

import type {FilePath} from '@parcel/types';

import {Transformer} from '@parcel/plugin';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import semver from 'semver';

const URL_RE = /url\s*\("?(?![a-z]+:)/;
const IMPORT_RE = /@import/;
const PROTOCOL_RE = /^[a-z]+:/;

function canHaveDependencies(filePath: FilePath, code: string) {
  return !/\.css$/.test(filePath) || IMPORT_RE.test(code) || URL_RE.test(code);
}

export default new Transformer({
  canReuseAST(ast) {
    return ast.type === 'postcss' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse(asset) {
    let code = await asset.getCode();
    if (!canHaveDependencies(asset.filePath, code)) {
      return null;
    }

    return {
      type: 'postcss',
      version: '7.0.0',
      isDirty: false,
      program: postcss.parse(code, {
        from: asset.filePath,
        to: asset.filePath
      })
    };
  },

  transform(asset) {
    let ast = asset.ast;
    if (!ast) {
      return [asset];
    }

    ast.program.walkAtRules('import', rule => {
      let params = valueParser(rule.params);
      let [name, ...media] = params.nodes;
      let moduleSpecifier;
      if (
        name.type === 'function' &&
        name.value === 'url' &&
        name.nodes.length
      ) {
        name = name.nodes[0];
      }

      moduleSpecifier = name.value;

      if (!moduleSpecifier) {
        throw new Error('Could not find import name for ' + rule);
      }

      if (PROTOCOL_RE.test(moduleSpecifier)) {
        return;
      }

      // If this came from an inline <style> tag, don't inline the imported file. Replace with the correct URL instead.
      // TODO: run CSSPackager on inline style tags.
      // let inlineHTML =
      //   this.options.rendition && this.options.rendition.inlineHTML;
      // if (inlineHTML) {
      //   name.value = asset.addURLDependency(dep, {loc: rule.source.start});
      //   rule.params = params.toString();
      // } else {
      media = valueParser.stringify(media).trim();
      let dep = {
        moduleSpecifier,
        loc: rule.source.start,
        meta: {
          media
        }
      };
      asset.addDependency(dep);
      rule.remove();
      // }

      ast.isDirty = true;
    });

    ast.program.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let isDirty = false;

        parsed.walk(node => {
          if (
            node.type === 'function' &&
            node.value === 'url' &&
            node.nodes.length
          ) {
            let url = asset.addURLDependency(node.nodes[0].value, {
              loc: decl.source.start
            });
            isDirty = node.nodes[0].value !== url;
            node.nodes[0].value = url;
          }
        });

        if (isDirty) {
          decl.value = parsed.toString();
          ast.isDirty = true;
        }
      }
    });

    return [asset];
  },

  async generate(asset) {
    let code;
    if (!asset.ast || !asset.ast.isDirty) {
      code = await asset.getCode();
    } else {
      code = '';
      postcss.stringify(asset.ast.program, c => (code += c));
    }

    return {
      code
    };
  }
});
