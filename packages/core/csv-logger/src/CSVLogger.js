// @flow strict-local

type CsvLoggerOpts = {|
  headers?: Array<string>,
  console?: boolean,
  file?: boolean,
|};

export class CSVLogger {
  file: boolean;
  fileName: string;
  globalParams: Array<string>;
  console: boolean;

  constructor(
    name: string,
    {headers, console = false, file = true}: CsvLoggerOpts = Object.freeze({}),
  ) {
    this.file = file;
    this.fileName = name.endsWith('.csv') ? name : `${name}.csv`;
    this.globalParams = [];

    if (headers && !require('fs').existsSync(this.fileName)) {
      this.logRow(...headers);
    }

    this.console = console;
    // flowlint sketchy-null-string:off
    if (process.env.CSV) {
      this.globalParams = process.env.CSV.split(',');
    }
  }

  now(): number {
    const {performance} = require('perf_hooks');

    return performance.now();
  }

  logRow(...row: Array<string | number>) {
    let value = this.globalParams.concat(row).join(',');

    if (this.console) {
      console.log(value);
    }

    if (this.file) {
      require('fs').appendFileSync(this.fileName, `${value}\n`);
    }
  }

  timeRow(...row: Array<string | number>): () => void {
    let startTime = this.now();

    return () => {
      this.logRow(...row, this.now() - startTime);
    };
  }
}

export const defaultCsvLogger = (filename: string): CSVLogger => {
  return new CSVLogger(filename, {console: false});
};
