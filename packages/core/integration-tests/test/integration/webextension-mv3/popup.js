import contentScript from 'url:./content-script.js';
let injectFile = document.getElementById('inject-file');
let injectFunction = document.getElementById('inject-function');

async function getCurrentTab() {
  let queryOptions = { active: true, currentWindow: true };
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

injectFile.addEventListener('click', async () => {
  let tab = await getCurrentTab();

  chrome.scripting.executeScript({
    target: {tabId: tab.id},
    files: [contentScript]
  });
});

function showAlert(givenName) {
  alert(`Hello, ${givenName}`);
}

injectFunction.addEventListener('click', async () => {
  let tab = await getCurrentTab();

  let name = 'World';
  chrome.scripting.executeScript({
    target: {tabId: tab.id},
    func: showAlert,
    args: [name]
  });
});
