import Parcel from '@parcel/core';
// import SimplePackageInstaller from './SimplePackageInstaller';
// import {NodePackageManager} from '@parcel/package-manager';
import defaultConfig from '@parcel/config-default';
import memFS from 'fs';
import workerFarm from '../workerFarm.js';
// import {prettifyTime} from '@parcel/utils';

const INPUT = {
  'index.js': `import lib from "./lib.js";
if (false) {
  console.log("dead code");
} else {
  console.log(lib);
}`,
  'lib.js': `export default 1234;`,
};

(async () => {
  // $FlowFixMe
  globalThis.PARCEL_DUMP_GRAPHVIZ = true;
  // globalThis.PARCEL_JSON_LOGGER_STDOUT = async d => {
  //   switch (d.type) {
  //     case 'buildStart':
  //       console.log('📦 Started');
  //       break;
  //     case 'buildProgress': {
  //       let phase = d.phase.charAt(0).toUpperCase() + d.phase.slice(1);
  //       let filePath = d.filePath || d.bundleFilePath;
  //       console.log(`🕓 ${phase} ${filePath ? filePath : ''}`);
  //       break;
  //     }
  //     case 'buildSuccess':
  //       console.log(`✅ Succeded in ${prettifyTime(d.buildTime)}`);

  //       console.group('Output');
  //       for (let {filePath} of d.bundles) {
  //         console.log(
  //           '%c%s:\n%c%s',
  //           'font-weight: bold',
  //           filePath,
  //           'font-family: monospace',
  //           await memFS.readFile(filePath, 'utf8'),
  //         );
  //       }
  //       console.groupEnd('Output');
  //       break;
  //     case 'buildFailure':
  //       console.log(`❗️`, d.diagnostics);
  //       break;
  //   }
  // };
  // globalThis.PARCEL_JSON_LOGGER_STDERR = globalThis.PARCEL_JSON_LOGGER_STDOUT;

  const b = new Parcel({
    entries: ['/src/index.js'],
    disableCache: true,
    mode: 'production',
    minify: true,
    logLevel: 'verbose',
    defaultConfig: {
      ...defaultConfig,
      reporters: ['@parcel/reporter-json'],
      filePath: '/',
    },
    hot: false,
    inputFS: memFS,
    outputFS: memFS,
    patchConsole: false,
    scopeHoist: true,
    workerFarm,
    // packageManager: new NodePackageManager(
    //   memFS,
    //   new SimplePackageInstaller(memFS),
    // ),
    defaultEngines: {
      browsers: ['last 1 Chrome version'],
      node: '10',
    },
  });

  await memFS.mkdirp('/src');
  await memFS.writeFile(
    '/package.json',
    JSON.stringify({
      engines: {node: '12'},
    }),
  );

  console.group('Input');
  for (let [name, contents] of Object.entries(INPUT)) {
    await memFS.writeFile(`/src/${name}`, contents);
    console.log(
      '%c%s:\n%c%s',
      'font-weight: bold',
      `/src/${name}`,
      'font-family: monospace',
      contents,
    );
  }
  console.groupEnd();

  await b.run();

  console.group('Output');
  console.log(
    '%c%s:\n%c%s',
    'font-weight: bold',
    `/dist/index.js`,
    'font-family: monospace',
    await memFS.readFile(`/dist/index.js`, 'utf8'),
  );
  console.groupEnd();

  // await workerFarm.end();
})();
