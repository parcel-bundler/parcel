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
import {
  useState,
  useEffect,
  useCallback,
  useReducer,
  useRef,
} from 'preact/hooks';
import {memo} from 'preact/compat';
import Asset from './components/Asset';
import SourceMapVisualiser from './components/SourceMapVisualiser';
import Options, {DEFAULT_OPTIONS} from './components/Options';
import {
  Graphs,
  Notes,
  ParcelError,
  Tabs,
  useDebounce,
  useSessionStorage,
  usePromise,
} from './components/helper';
import Preview from './components/Preview';

import filesize from 'filesize';
import {
  assetsReducer,
  ASSET_PRESETS,
  generatePackageJson,
  loadState,
  saveState,
  // downloadBuffer
} from './utils';
import {
  bundle,
  watch,
  workerReady,
  waitForFS,
  clientID as clientIDPromise,
} from './parcel/';

const READY = Symbol('READY');
const BUNDLING_RUNNING = Symbol('BUNDLING_RUNNING');
const BUNDLING_FINISHED = Symbol('BUNDLING_FINISHED');
const WATCHING_READY = Symbol('WATCHING_READY');
const WATCHING_RUNNING = Symbol('WATCHING_RUNNING');
const WATCHING_FINISHED = Symbol('WATCHING_FINISHED');

function isWatching(s: Symbol) {
  return (
    s === WATCHING_READY || s === WATCHING_RUNNING || s === WATCHING_FINISHED
  );
}

function isRunning(s: Symbol) {
  return s === BUNDLING_RUNNING || s === WATCHING_RUNNING;
}

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
  const [assetDiagnostics, setAssetDiagnostics] = useState(new Map());
  const [options, setOptions]: [REPLOptions, Function] = useReducer(
    optionsReducer,
    initialHashState.options || DEFAULT_OPTIONS,
  );

  const [currentPreset, setCurrentPreset]: [
    string,
    (string) => void,
  ] = useState(initialHashState.currentPreset || DEFAULT_PRESET);

  const [bundlingState, setBundlingState] = useState(READY);
  const [bundlingStateInfo, setBundlingStateInfo] = useState(null);
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

  const watchSubscriptionRef = useRef();

  const assetsDebouncedWatch = useDebounce(assets, 200);
  useEffect(() => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.writeAssets(assetsDebouncedWatch);
      setBundlingState(WATCHING_RUNNING);
    }
  }, [assetsDebouncedWatch]);

  const toggleWatching = useCallback(async () => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.unsubscribe();
      watchSubscriptionRef.current = false;
      setBundlingState(READY);
    } else {
      setBundlingState(WATCHING_RUNNING);
      let {unsubscribe, writeAssets} = await watch(
        assets,
        options,
        bundleOutput => {
          setBundlingState(WATCHING_FINISHED);
          setOutput(bundleOutput);
          if (bundleOutput.type === 'failure' && bundleOutput.diagnostics) {
            setAssetDiagnostics(bundleOutput.diagnostics);
          } else {
            setAssetDiagnostics(new Map());
          }
        },
        v => {
          setBundlingStateInfo(v);
        },
      );
      watchSubscriptionRef.current = {unsubscribe, writeAssets};
    }
  }, []);

  let [clientID] = usePromise(clientIDPromise);

  let [tabIndex, setTabIndex] = useSessionStorage('tabIndex', 0);

  const startBundling = useCallback(async () => {
    if (bundlingState === BUNDLING_RUNNING) return;
    setBundlingState(BUNDLING_RUNNING);
    setBundlingStateInfo(null);

    try {
      const bundleOutput = await bundle(assets, options, v => {
        setBundlingStateInfo(v);
      });

      setBundlingState(BUNDLING_FINISHED);
      setOutput(bundleOutput);
      if (bundleOutput.type === 'failure' && bundleOutput.diagnostics) {
        setAssetDiagnostics(bundleOutput.diagnostics);
      } else {
        setAssetDiagnostics(new Map());
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
    setBundlingState(READY);
  }, []);

  const changeAssetNameCb = useCallback(
      (name, newName) => setAssets(assetsReducer.changeName(name, newName)),
      [],
    ),
    changeAssetContentCb = useCallback(
      (name, content) => setAssets(assetsReducer.changeContent(name, content)),
      [],
    ),
    changeAssetEntryCb = useCallback(
      (name, isEntry) => setAssets(assetsReducer.changeEntry(name, isEntry)),
      [],
    ),
    removeAssetCb = useCallback(
      name => setAssets(assetsReducer.remove(name)),
      [],
    ),
    addAssetCb = useCallback(() => setAssets(assetsReducer.add()), []),
    changeOptionsCb = useCallback(
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
        <PresetSelector
          currentPreset={currentPreset}
          changePresetCb={changePresetCb}
        />
        {assets.map(({name, content, isEntry}, i) => (
          <Asset
            key={i}
            name={name}
            onChangeName={changeAssetNameCb}
            content={content}
            onChangeContent={changeAssetContentCb}
            isEntry={isEntry}
            onChangeEntry={changeAssetEntryCb}
            onClickRemove={removeAssetCb}
            diagnostics={assetDiagnostics.get(name)}
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
          Bundle
        </button>
        <button class="start" onClick={toggleWatching}>
          {isWatching(bundlingState) ? 'Stop watching' : 'Watch'}
        </button>
        <Options
          values={options}
          onChange={changeOptionsCb}
          disabled={isWatching(bundlingState)}
          disablePackageJSON={assets.some(a => a.name === 'package.json')}
        />
        <Notes />
      </div>
      <div class="column">
        <StatusIndicator
          bundlingState={bundlingState}
          bundlingStateInfo={bundlingStateInfo}
          workerState={workerState}
          buildDuration={output?.type === 'success' && output.buildTime}
        />
        {(() => {
          if (output) {
            if (output.type === 'success') {
              return (
                <Tabs
                  names={['Output', 'Preview']}
                  selected={tabIndex}
                  setSelected={setTabIndex}
                >
                  <div class="column">
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
                    {/* <button disabled onClick={downloadZip}>
                      Download ZIP
                    </button> */}
                  </div>
                  <div>
                    {clientID && (
                      <Preview clientID={waitForFS().then(() => clientID)} />
                    )}
                  </div>
                </Tabs>
              );
            } else {
              // TODO always show preview, even with errors. this should only replace the bundle output.
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
                    Bundle
                  </button>{' '}
                  to get started!
                </div>
              </div>
            );
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

function StatusIndicator({
  bundlingState,
  bundlingStateInfo,
  workerState,
  buildDuration,
}) {
  let text;

  buildDuration = Math.round(buildDuration / 10) / 100;

  if (workerState === WORKER_STATE_LOADING) {
    text = 'Starting up Parcel...';
  } else {
    switch (bundlingState) {
      case BUNDLING_RUNNING:
        text = `Running: ${bundlingStateInfo ?? ''}`;
        break;
      case BUNDLING_FINISHED:
        text = `Finished (took ${buildDuration}s)`;
        break;
      case WATCHING_READY:
        text = 'Watching';
        break;
      case WATCHING_RUNNING:
        text = `Watching: ${bundlingStateInfo ?? ''}`;
        break;
      case WATCHING_FINISHED:
        text = `Watching (took ${buildDuration}s)`;
        break;
      default:
        text = 'Parcel is ready';
        break;
    }
  }

  let classState;
  if (workerState === WORKER_STATE_LOADING) {
    classState = 'loading';
  } else if (isWatching(bundlingState)) {
    classState = 'watching';
  } else {
    classState = !isRunning(bundlingState) ? 'ready' : 'loading';
  }

  return <div class={`loadState ${classState}`}>{text}</div>;
}

const PresetSelector = memo(
  function PresetSelector({currentPreset, changePresetCb}) {
    return (
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
    );
  },
  (prevProps, nextProps) => {
    return prevProps.currentPreset === nextProps.currentPreset;
  },
);

render(<App />, document.getElementById('root'));

if (navigator.serviceWorker) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    // eslint-disable-next-line no-console
    console.error('Service worker registration failed:', error);
  });
}
