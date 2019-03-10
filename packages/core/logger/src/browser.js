const {countBreaks} = require('grapheme-breaker');
const chalk = require('chalk');
const stripAnsi = require('strip-ansi');

// Count visible characters in a string
function stringWidth(string) {
  return countBreaks(stripAnsi('' + string));
}

// Pad a string with spaces on either side
function pad(text, length, align = 'left') {
  let pad = ' '.repeat(length - stringWidth(text));
  if (align === 'right') {
    return pad + text;
  }

  return text + pad;
}

module.exports = {
  logLevel: 3,
  warn(v) {
    if (this.logLevel < 2) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(v);
  },
  error(v) {
    if (this.logLevel < 1) {
      return;
    }
    // eslint-disable-next-line no-console
    console.error(v);
  },
  verbose(v) {
    if (this.logLevel < 4) {
      return;
    }
    // eslint-disable-next-line no-console
    console.info(v);
  },
  progress(message) {
    if (this.logLevel < 3) {
      return;
    }

    if (this.logLevel > 3) {
      return this.verbose(message);
    }
  },
  success(v) {
    this.log(v);
  },
  log(v) {
    if (this.logLevel < 3) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(v);
  },
  table(columns, table) {
    // Measure column widths
    let colWidths = [];
    for (let row of table) {
      let i = 0;
      for (let item of row) {
        colWidths[i] = Math.max(colWidths[i] || 0, stringWidth(item));
        i++;
      }
    }

    // Render rows
    for (let row of table) {
      let items = row.map((item, i) => {
        // Add padding between columns unless the alignment is the opposite to the
        // next column and pad to the column width.
        let padding =
          !columns[i + 1] || columns[i + 1].align === columns[i].align ? 4 : 0;
        return pad(item, colWidths[i] + padding, columns[i].align);
      });

      this.log(items.join(''));
    }
  },
  clear() {},
  setOptions(options) {
    this.logLevel = Number(options.logLevel);
  },
  chalk: new chalk.constructor({enabled: false})
};
