// @flow
import type {
  ScopeHoistingPackager,
  OutputFormat,
} from './ScopeHoistingPackager';

// List of engines that support object destructuring syntax
const DESTRUCTURING_ENGINES = {
  chrome: '51',
  edge: '15',
  firefox: '53',
  safari: '10',
  node: '6.5',
  ios: '10',
  samsung: '5',
  opera: '38',
  electron: '1.2',
};

export class CJSOutputFormat implements OutputFormat {
  packager: ScopeHoistingPackager;

  constructor(packager: ScopeHoistingPackager) {
    this.packager = packager;
  }

  buildBundlePrelude(): [string, number] {
    let res = '';
    let lines = 0;

    for (let [source, specifiers] of this.packager.externals) {
      let properties = [];
      let categories = new Set();
      for (let [imported, symbol] of specifiers) {
        if (imported === '*') {
          categories.add('namespace');
        } else if (imported === 'default') {
          categories.add('default');
        } else {
          categories.add('named');
          properties.push({
            key: imported,
            value: symbol,
          });
        }
      }

      let specifiersWildcard = specifiers.get('*');
      let specifiersDefault = specifiers.get('default');

      // Attempt to combine require calls as much as possible. Namespace, default, and named specifiers
      // cannot be combined, so in the case where we have more than one type, assign the require() result
      // to a variable first and then create additional variables for each specifier based on that.
      // Otherwise, if just one category is imported, just assign and require all at once.
      if (categories.size > 1) {
        let name = specifiersWildcard || this.packager.getTopLevelName(source);
        res += `var ${name} = require(${JSON.stringify(source)});\n`;
        lines++;

        if (specifiersDefault) {
          res += `var ${specifiersDefault} = $parcel$interopDefault(${name});\n`;
          lines++;
          this.packager.usedHelpers.add('$parcel$interopDefault');
        }

        if (properties.length > 0) {
          let [r, l] = this.generateDestructuringAssignment(
            properties,
            name,
            true,
          );

          res += r;
          lines += l;
        }
      } else if (specifiersDefault) {
        res += `var ${specifiersDefault} = $parcel$interopDefault(require(${JSON.stringify(
          source,
        )}));\n`;
        lines++;
        this.packager.usedHelpers.add('$parcel$interopDefault');
      } else if (specifiersWildcard) {
        res += `var ${specifiersWildcard} = require(${JSON.stringify(
          source,
        )});\n`;
        lines++;
      } else if (properties.length > 0) {
        let [r, l] = this.generateDestructuringAssignment(
          properties,
          `require(${JSON.stringify(source)})`,
          false,
        );

        res += r;
        lines += l;
      } else {
        res += `require(${JSON.stringify(source)});\n`;
        lines++;
      }
    }

    if (res.length > 0) {
      res += '\n';
      lines++;
    }

    return [res, lines];
  }

  generateDestructuringAssignment(
    specifiers: Array<{|key: string, value: string|}>,
    value: string,
    isIdentifier: boolean,
  ): [string, number] {
    let res = '';
    let lines = 0;

    // If destructuring is not supported, generate a series of variable declarations
    // with member expressions for each property.
    if (!this.packager.bundle.env.matchesEngines(DESTRUCTURING_ENGINES)) {
      if (!isIdentifier && specifiers.length > 1) {
        let name = this.packager.getTopLevelName('temp');
        res += `var ${name} = ${value};\n`;
        lines++;
        value = name;
      }

      for (let specifier of specifiers) {
        res += `var ${specifier.value} = ${value}.${specifier.key};\n`;
        lines++;
      }

      return [res, lines];
    }

    let s = specifiers.map(specifier => {
      let s = specifier.key;
      if (specifier.value !== specifier.key) {
        s += `: ${specifier.value}`;
      }

      return s;
    });

    res += `var {${s.join(', ')}} = ${value};\n`;
    lines++;

    return [res, lines];
  }

  buildBundlePostlude(): string {
    return '';
  }
}
