// @flow
import {Transformer} from '@parcel/plugin';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import semver from 'semver';

const URL_RE = /url\s*\("?(?![a-z]+:)/;
const IMPORT_RE = /@import/;
const PROTOCOL_RE = /^[a-z]+:/;

function canHaveDependencies(asset) {
  let {filePath, code} = asset;
  return !/\.css$/.test(filePath) || IMPORT_RE.test(code) || URL_RE.test(code);
}

function addURLDependency(asset, url: string, opts) {
  asset.addDependency({
    moduleSpecifier: url,
    isAsync: true,
    ...opts
  });
}

export default new Transformer({
  canReuseAST(ast) {
    return ast.type === 'postcss' && semver.satisfies(ast.version, '^7.0.0');
  },

  parse(asset) {
    if (!canHaveDependencies(asset)) {
      return null;
    }

    return {
      type: 'postcss',
      version: '7.0.0',
      isDirty: false,
      program: postcss.parse(asset.code, {
        from: asset.filePath,
        to: asset.filePath
      })
    };
  },

  transform(asset) {
    if (!asset.ast) {
      return [asset];
    }

    asset.ast.program.walkAtRules('import', rule => {
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
      //   name.value = addURLDependency(asset, dep, {loc: rule.source.start});
      //   rule.params = params.toString();
      // } else {
      media = valueParser.stringify(media).trim();
      let dep = {
        moduleSpecifier,
        media,
        loc: rule.source.start
      };
      asset.addDependency(dep);
      rule.remove();
      // }

      asset.ast.isDirty = true;
    });

    asset.ast.program.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let isDirty = false;

        parsed.walk(node => {
          if (
            node.type === 'function' &&
            node.value === 'url' &&
            node.nodes.length
          ) {
            let url = addURLDependency(asset, node.nodes[0].value, {
              loc: decl.source.start
            });
            isDirty = node.nodes[0].value !== url;
            node.nodes[0].value = url;
          }
        });

        if (isDirty) {
          decl.value = parsed.toString();
          asset.ast.isDirty = true;
        }
      }
    });

    return [asset];
  },

  generate(asset) {
    let code;
    if (!asset.ast.isDirty) {
      code = asset.code;
    } else {
      code = '';
      postcss.stringify(asset.ast.program, c => (code += c));
    }

    return {
      code
    };
  }
});
