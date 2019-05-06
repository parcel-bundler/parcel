if (process.env.NODE_ENV === 'development') {
  require('preact/debug');
}

/* eslint-disable no-unused-vars */
import {h, render, Component, Fragment} from 'preact';
import Asset from './components/Asset';
import Options from './components/Options';
import Preview from './components/Preview';
import {ParcelError, Notes, Box} from './components/helper';
/* eslint-enable no-unused-vars */

import filesize from 'filesize';
import {
  PRESETS,
  hasBrowserslist,
  saveState,
  loadState,
  createDebouncer,
  downloadBuffer
} from './utils';
import bundle, {workerLoaded, getFS, getZip} from './parcel/';

async function downloadZip() {
  downloadBuffer('Parcel-REPL.zip', await getZip());
}

const DEFAULT_PRESET = 'Javascript';

// eslint-disable-next-line no-unused-vars
class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      output: null,

      bundling: false,
      bundlingError: null,

      workerReady: false,

      installPrompt: null
    };

    let hashData;
    if (window.location.hash && (hashData = loadState())) {
      this.state = {
        ...this.state,
        ...hashData
      };
    } else {
      this.state = {
        ...this.state,
        currentPreset: DEFAULT_PRESET,
        assets: PRESETS[DEFAULT_PRESET],
        options: {
          minify: true,
          scopeHoist: true,
          sourceMaps: false,
          contentHash: true,
          browserslist: '',
          publicUrl: '',
          target: 'browser',
          global: ''
        }
      };
    }

    this.hashDebouncer = createDebouncer(
      that =>
        saveState(
          that.state.currentPreset,
          that.state.options,
          that.state.assets
        ),
      400,
      this
    );

    workerLoaded.then(() => this.setState({workerReady: true}));
  }

  async startBundling() {
    if (this.state.bundling) return;
    this.setState({bundling: true});

    try {
      const output = await bundle(this.state.assets, this.state.options);

      // await new Promise(async res => {
      //   window.addEventListener(
      //     'message',
      //     e => {
      //       console.log(e);
      //       res();
      //     },
      //     {once: true}
      //   );
      const sw = await navigator.serviceWorker.ready;
      if (sw.active) {
        sw.active.postMessage(await getFS());
      }
      // });

      await this.setState({
        bundling: false,
        bundlingError: null,
        output
      });
    } catch (error) {
      this.setState({
        bundling: false,
        bundlingError: error,
        output: null
      });
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  componentDidMount() {
    document.addEventListener('keydown', e => {
      if (e.metaKey) {
        if (e.code === 'Enter' || e.code === 'KeyB') {
          this.startBundling();
        } else if (e.code === 'KeyS') {
          e.preventDefault();
          if (this.state.output) downloadZip();
        }
      }
    });

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.setState({
        installPrompt: e
      });
    });
  }

  async showInstallPrompt() {
    this.state.installPrompt.prompt();

    const result = await this.state.installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      this.setState({
        installPrompt: null
      });
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      this.state.assets !== prevState.assets ||
      this.state.options !== prevState.options ||
      this.state.currentPreset !== prevState.currentPreset
    ) {
      this.hashDebouncer();
    }
  }

  updateAsset(name, prop, value) {
    this.setState(state => ({
      assets: state.assets.map(
        a => (a.name === name ? {...a, [prop]: value} : a)
      )
    }));
  }

  render() {
    // console.log(JSON.stringify(this.state.assets));
    return (
      <div id="app">
        <div class="row">
          <label class="presets">
            <span>Preset:</span>
            <select
              onChange={e =>
                this.setState({
                  currentPreset: e.target.value,
                  assets: PRESETS[e.target.value],
                  output: null,
                  bundlingError: null
                })
              }
              value={this.state.currentPreset}
            >
              {Object.keys(PRESETS).map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {this.state.assets.map(({name, content, isEntry}, i) => (
            <Asset
              key={i}
              name={name}
              onChangeName={v => {
                if (this.state.assets.find(a => a.name === v)) {
                  this.updateAsset(name, 'name', name);
                } else {
                  this.updateAsset(name, 'name', v);
                }
              }}
              content={content}
              onChangeContent={v => this.updateAsset(name, 'content', v)}
              editable
              isEntry={isEntry}
              onChangeEntry={v => this.updateAsset(name, 'isEntry', v)}
              onClickRemove={v =>
                this.setState(state => ({
                  assets: state.assets.filter(a => a.name !== v)
                }))
              }
            />
          ))}
          <button
            class="addAsset"
            onClick={() => {
              let nameIndex = 0;
              while (
                this.state.assets.find(
                  v =>
                    v.name == 'new' + (nameIndex ? `-${nameIndex}` : '') + '.js'
                )
              )
                nameIndex++;

              this.setState(state => ({
                assets: [
                  ...state.assets,
                  {
                    name: 'new' + (nameIndex ? `-${nameIndex}` : '') + '.js',
                    content: '',
                    isEntry: false
                  }
                ]
              }));
            }}
          >
            Add asset
          </button>
          <button
            class="start"
            disabled={this.state.bundling}
            onClick={() => this.startBundling()}
          >
            Bundle!
          </button>
          <Options
            values={this.state.options}
            onChange={(name, value) =>
              this.setState(state => ({
                options: {
                  ...state.options,
                  [name]: value
                }
              }))
            }
            enableBrowserslist={!hasBrowserslist(this.state.assets)}
          />
          <Notes />
        </div>
        <div class="row">
          {this.state.workerReady ? (
            <div class="loadState ready">Parcel is ready</div>
          ) : (
            <div class="loadState loading">Parcel is being loaded...</div>
          )}
          {(() => {
            if (this.state.bundlingError) {
              return <ParcelError error={this.state.bundlingError} />;
            } else {
              return this.state.output ? (
                <Fragment>
                  {this.state.output.map(({name, content}) => (
                    <Asset
                      key={name}
                      name={name.trim()}
                      content={content}
                      additionalHeader={
                        <div class="outputSize">{filesize(content.length)}</div>
                      }
                    />
                  ))}
                  <Preview
                    assets={this.state.assets}
                    output={this.state.output}
                    options={this.state.options}
                  />
                </Fragment>
              ) : (
                <div class="file gettingStarted">
                  <div>
                    Click on{' '}
                    <button
                      class="start"
                      disabled={this.state.bundling}
                      onClick={() => this.startBundling()}
                    >
                      Bundle!
                    </button>{' '}
                    to get started!
                  </div>
                </div>
              );
            }
          })()}
          {this.state.installPrompt && (
            <button
              class="installPrompt"
              onClick={() => this.showInstallPrompt()}
            >
              Want to add this to your homescreen?
            </button>
          )}
          {this.state.output && (
            <button onClick={downloadZip}>Download ZIP</button>
          )}
        </div>
      </div>
    );
  }
}

render(<App />, document.getElementById('root'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    // eslint-disable-next-line no-console
    console.error('Service worker registration failed:', error);
  });
}
