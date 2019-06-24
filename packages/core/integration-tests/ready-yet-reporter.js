// my-reporter.js
const mocha = require('mocha');
const path = require('path');
const fs = require('fs');
const {execSync} = require('child_process');

function importantData(test, status) {
  let fileName = path.basename(test.file, '.js');
  return {
    fileName,
    link: `https://github.com/parcel-bundler/parcel/tree/v2/packages/core/integration-tests/test/${fileName}.js`,
    title: test.title,
    status
  };
}

function ReadyYetReporter(runner) {
  mocha.reporters.Base.call(this, runner);
  let tests = [];
  let numPassing = 0;

  runner.on('pending', function(test) {
    tests.push(importantData(test, 'pending'));
  });

  runner.on('pass', function(test) {
    numPassing++;
    tests.push(importantData(test, 'passing'));
  });

  runner.on('fail', function(test) {
    tests.push(importantData(test, 'failing'));
  });

  runner.on('end', function() {
    let ratio = `${numPassing}/${tests.length}`;
    let commitHash = execSync('git rev-parse HEAD').toString();
    commitHash = commitHash.substring(0, commitHash.length - 1); // Get rid of newline
    let commitDate = execSync(
      `git show -s --format=%ci ${commitHash}`
    ).toString();
    commitDate = commitDate.substring(0, commitDate.lastIndexOf(' ')); // Get rid of timezone
    let testHistory = JSON.parse(
      fs.readFileSync('data/testHistory.json', 'utf8')
    );
    let shouldWrite = testHistory.length === 0 || testHistory[0][2] !== ratio;
    if (shouldWrite) {
      testHistory.push([commitHash, commitDate, ratio]);
      fs.writeFileSync(
        'data/testHistory.json',
        JSON.stringify(testHistory),
        'utf8'
      );
      fs.writeFileSync(
        'data/lastTestRun.json',
        JSON.stringify({tests}),
        'utf8'
      );
    }
  });
}

module.exports = ReadyYetReporter;
