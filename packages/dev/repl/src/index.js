// @flow
// @jsx h
/* eslint-disable import/first */
if (process.env.NODE_ENV === 'development') {
  require('preact/debug');
}
import type {Assets, REPLOptions} from './utils';
import type {BundleOutput} from './parcel/ParcelWorker';

// eslint-disable-next-line no-unused-vars
import {h, render, Fragment} from 'preact';
import {useState, useEffect, useCallback, useReducer} from 'preact/hooks';
import Asset from './components/Asset';
import SourceMapVisualiser from './components/SourceMapVisualiser';
import Options, {DEFAULT_OPTIONS} from './components/Options';
import {ParcelError, Notes, Graphs, useDebounce} from './components/helper';
// import Preview from './components/Preview';

import filesize from 'filesize';
import {
  assetsReducer,
  ASSET_PRESETS,
  generatePackageJson,
  loadState,
  saveState,
  // downloadBuffer
} from './utils';
import {bundle, workerReady} from './parcel/';

const BUNDLING_READY = Symbol('BUNDLING_READY');
const BUNDLING_RUNNING = Symbol('BUNDLING_RUNNING');
const BUNDLING_FINISHED = Symbol('BUNDLING_FINISHED');

const WORKER_STATE_LOADING = Symbol('WORKER_STATE_LOADING');
const WORKER_STATE_SUCCESS = Symbol('WORKER_STATE_SUCCESS');

const DEFAULT_PRESET = 'Javascript';

function optionsReducer(options, {name, value}) {
  return {
    ...options,
    [name]: value,
  };
}
optionsReducer.update = (name, value) => ({name, value});

const initialHashState = loadState() || {};
function App() {
  const [assets, setAssets]: [Assets, Function] = useReducer(
    assetsReducer,
    initialHashState.assets || ASSET_PRESETS[DEFAULT_PRESET],
  );
  const [options, setOptions]: [REPLOptions, Function] = useReducer(
    optionsReducer,
    initialHashState.options || DEFAULT_OPTIONS,
  );

  const [currentPreset, setCurrentPreset]: [
    string,
    (string) => void,
  ] = useState(initialHashState.currentPreset || DEFAULT_PRESET);

  const [bundlingState, setBundlingState] = useState(BUNDLING_READY);
  const [workerState, setWorkerState] = useState(WORKER_STATE_LOADING);
  useEffect(async () => {
    await workerReady;
    setWorkerState(WORKER_STATE_SUCCESS);
  }, []);
  const [output, setOutput]: [
    ?BundleOutput,
    (?BundleOutput) => void,
  ] = useState();

  const [installPrompt, setInstallPrompt] = useState(null);

  const assetsDebounced = useDebounce(assets, 500);
  useEffect(() => {
    saveState(currentPreset, options, assetsDebounced);
  }, [currentPreset, options, assetsDebounced]);
  // const hashChangeCb = useCallback(() => {
  //  let state = loadState();
  //  if (state) {
  //    console.log(state)
  //    setAssets(state.assets);
  //    setOptions(state.options);
  //    setCurrentPreset(state.currentPreset);
  //  }
  // }, []);
  // useEffect(() => {
  //  window.addEventListener("hashchange", hashChangeCb);
  //  return () => window.removeEventListener("hashchange", hashChangeCb);
  // }, []);

  const startBundling = useCallback(async () => {
    if (bundlingState === BUNDLING_RUNNING) return;
    setBundlingState(BUNDLING_RUNNING);

    try {
      const bundleOutput = await bundle(assets, options);

      // await new Promise(async res => {
      //   window.addEventListener(
      //     'message',
      //     e => {
      //       console.log(e);
      //       res();
      //     },
      //     {once: true}
      //   );
      // const sw = await navigator.serviceWorker.ready;
      // if (sw.active) {
      //   sw.active.postMessage(await getFS());
      // }
      // });

      setBundlingState(BUNDLING_FINISHED);
      setOutput(bundleOutput);
      setAssets(assetsReducer.clearDiagnostics());
      if (bundleOutput.type === 'failure') {
        if (bundleOutput.diagnostics) {
          for (let [asset, assetDiagnostics] of bundleOutput.diagnostics) {
            setAssets(assetsReducer.changeDiagnostics(asset, assetDiagnostics));
          }
        }
      }
    } catch (error) {
      console.error('Unexpected error', error);
    }
  }, [bundlingState, assets, options]);

  const keydownCb = useCallback(
    e => {
      if (e.metaKey) {
        if (e.code === 'Enter' || e.code === 'KeyB') {
          e.preventDefault();
          startBundling();
        } else if (e.code === 'KeyS') {
          e.preventDefault();
          // if (output) downloadZip();
        }
      }
    },
    [startBundling],
  );

  const beforeinstallpromptCb = useCallback(e => {
    e.preventDefault();
    setInstallPrompt(e);
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', keydownCb);
    window.addEventListener('beforeinstallprompt', beforeinstallpromptCb);
    return () => {
      document.removeEventListener('keydown', keydownCb);
      window.removeEventListener('beforeinstallprompt', beforeinstallpromptCb);
    };
  }, [beforeinstallpromptCb, keydownCb]);

  const changePresetCb = useCallback(e => {
    setOutput(null);
    setCurrentPreset(e.target.value);
    setAssets(assetsReducer.setAssets(ASSET_PRESETS[e.target.value]));
    setBundlingState(BUNDLING_READY);
  }, []);

  const changeAssetNameCb = useCallback(
    (name, newName) => setAssets(assetsReducer.changeName(name, newName)),
    [],
  );
  const changeAssetContentCb = useCallback(
    (name, content) => setAssets(assetsReducer.changeContent(name, content)),
    [],
  );
  const changeAssetEntryCb = useCallback(
    (name, isEntry) => setAssets(assetsReducer.changeEntry(name, isEntry)),
    [],
  );
  const removeAssetCb = useCallback(
    name => setAssets(assetsReducer.remove(name)),
    [],
  );

  const addAssetCb = useCallback(() => setAssets(assetsReducer.add()), []);

  const changeOptionsCb = useCallback(
    (name, value) => setOptions(optionsReducer.update(name, value)),
    [],
  );

  const promptInstallCb = useCallback(async () => {
    installPrompt.prompt();

    const result = await this.state.installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  }, []);

  return (
    <div id="app">
      <div class="column">
        <label class="presets">
          <span>Preset:</span>
          <select onChange={changePresetCb} value={currentPreset}>
            {Object.keys(ASSET_PRESETS).map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {assets.map(({name, content, isEntry, diagnostics}, i) => (
          <Asset
            key={i}
            name={name}
            onChangeName={changeAssetNameCb}
            content={content}
            onChangeContent={changeAssetContentCb}
            isEntry={isEntry}
            onChangeEntry={changeAssetEntryCb}
            onClickRemove={removeAssetCb}
            diagnostics={diagnostics}
          />
        ))}
        {assets.every(a => a.name !== 'package.json') && (
          <Asset
            name="package.json"
            content={generatePackageJson(options)}
            readOnly
            // diagnostics={diagnostics}
            class="packageJson"
          />
        )}
        <button class="addAsset" onClick={addAssetCb}>
          Add asset
        </button>
        <button
          class="start"
          disabled={bundlingState === BUNDLING_RUNNING}
          onClick={startBundling}
        >
          Bundle!
        </button>
        <Options values={options} onChange={changeOptionsCb} />
        <Notes />
      </div>
      <div class="column">
        {bundlingState === BUNDLING_READY ? (
          workerState === WORKER_STATE_SUCCESS ? (
            <div class="loadState ready">Parcel is ready</div>
          ) : (
            <div class="loadState loading">Starting up Parcel...</div>
          )
        ) : bundlingState === BUNDLING_FINISHED ? (
          <div class="loadState ready">Bundling finished</div>
        ) : (
          <div class="loadState loading">Bundling...</div>
        )}
        {(() => {
          if (bundlingState === BUNDLING_FINISHED) {
            if (output) {
              if (output.type === 'success') {
                return (
                  <Fragment>
                    {output.bundles.map(({name, content, size}) => (
                      <Asset
                        key={name}
                        name={name.trim()}
                        content={content}
                        additionalHeader={
                          <div class="outputSize">{filesize(size)}</div>
                        }
                        readOnly
                      />
                    ))}
                    {output.graphs && <Graphs graphs={output.graphs} />}
                    {output.sourcemaps && (
                      <SourceMapVisualiser maps={output.sourcemaps} />
                    )}
                    {/* <Preview output={output.assets} options={options} /> */}
                    {/* <button disabled onClick={downloadZip}>
                      Download ZIP
                    </button> */}
                  </Fragment>
                );
              } else {
                return <ParcelError error={output} />;
              }
            } else {
              return (
                <div class="file gettingStarted">
                  <div>
                    Click on{' '}
                    <button
                      class="start"
                      disabled={bundlingState === BUNDLING_RUNNING}
                      onClick={startBundling}
                    >
                      Bundle!
                    </button>{' '}
                    to get started!
                  </div>
                </div>
              );
            }
          }
        })()}
        {installPrompt && (
          <button class="installPrompt" onClick={promptInstallCb} disabled>
            Want to add this to your homescreen?
          </button>
        )}
      </div>
    </div>
  );
}

render(<App />, document.getElementById('root'));

// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('./sw.js').catch(error => {
//     // eslint-disable-next-line no-console
//     console.error('Service worker registration failed:', error);
//   });
// }
