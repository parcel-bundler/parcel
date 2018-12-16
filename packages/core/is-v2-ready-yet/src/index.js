import React from 'react';
import ReactDOM from 'react-dom';
import fs from 'fs';
import App from './App';
import testData from '@parcel/integration-tests/data/lastTestRun';
import testHistory from '@parcel/integration-tests/data/testHistory';

import './css/reset.css';
import './css/index.css';

let graphData = processGraphData(testHistory);

function processGraphData(rawGraphData) {
  let toInt = str => parseInt(str, 10);
  return rawGraphData.map((string, index) => {
    let [gitHash, dateStr, progress] = string.split(/[\t]/);
    let dateParts = dateStr.split(/[ :-]/).map(toInt);
    let [year, month, day, hours, minutes, seconds] = dateParts;
    let date = new Date(year, month - 1, day, hours, minutes, seconds);
    let timestamp = date.getTime();
    let [passing, total] = progress.split(/\//).map(toInt);
    let percent = parseFloat(((passing / total) * 100).toFixed(1), 10);
    return {
      index,
      gitHash,
      date,
      dateStr,
      timestamp,
      total,
      passing,
      percent,
      x: date,
      y: percent
    };
  });
}

let render = () => {
  let root = document.getElementById('app');

  ReactDOM.render(
    <App
      width={root.clientWidth}
      testData={testData}
      graphData={graphData}
      mostRecent={graphData[graphData.length - 1]}
    />,
    document.getElementById('app')
  );
};

window.addEventListener('resize', render, false);
render();
