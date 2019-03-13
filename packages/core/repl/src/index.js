import {h, render, Component, Fragment} from 'preact';
import filesize from 'filesize';

import Asset from './components/Asset';
import Options from './components/Options';
import {Notes, ParcelError, PRESETS, hasBrowserslist} from './utils';
import bundle, {workerLoaded} from './bundle';

const DEFAULT_PRESET = 'Javascript';

function saveState(curPreset, options, assets) {
  let data = {
    currentPreset: curPreset,
    options,
    assets: assets.map(
      ({name, content, isEntry = false}) =>
        isEntry ? [name, content, 1] : [name, content]
    )
  };

  window.location.hash = btoa(encodeURIComponent(JSON.stringify(data)));
}

function loadState() {
  const hash = window.location.hash.replace(/^#/, '');

  try {
    const data = JSON.parse(decodeURIComponent(atob(hash)));
    data.assets = data.assets.map(([name, content, isEntry = false]) => ({
      name,
      content,
      isEntry: Boolean(isEntry)
    }));
    return data;
  } catch (e) {
    console.error('Hash decoding failed:', e);
    window.location.hash = '';
    return null;
  }
}

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      output: null,

      bundling: false,
      bundlingError: null,

      workerReady: false
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
        options: {}
      };
    }

    const options = this.state.options;
    if (!('minify' in options)) options.minify = true;
    if (!('scopeHoist' in options)) options.scopeHoist = true;
    if (!('sourceMaps' in options)) options.sourceMaps = false;
    if (!('browserslist' in options)) options.browserslist = 'Chrome 70';
    if (!('publicUrl' in options)) options.publicUrl = '/';

    workerLoaded.then(() => this.setState({workerReady: true}));
  }

  async startBundling() {
    if (this.state.bundling) return;
    this.setState({bundling: true});

    try {
      const output = await bundle(this.state.assets, this.state.options);
      this.setState({
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
      console.error(error);
    }
  }

  componentDidMount() {
    document.addEventListener('keydown', e => {
      if (e.metaKey && e.code === 'Enter') this.startBundling();
    });
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      this.state.assets !== prevState.assets ||
      this.state.options !== prevState.options ||
      this.state.currentPreset !== prevState.currentPreset
    ) {
      saveState(
        this.state.currentPreset,
        this.state.options,
        this.state.assets
      );
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
    // console.log(JSON.stringify(this.state.output));
    return (
      <div id="app">
        <div class="row">
          <select
            class="presets"
            onChange={e =>
              this.setState({
                currentPreset: e.target.value,
                assets: PRESETS[e.target.value]
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
          {this.state.assets.map(({name, content, isEntry}) => (
            <Asset
              key={name}
              name={name}
              onChangeName={v => this.updateAsset(name, 'name', v)}
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
            onClick={() =>
              this.setState(state => ({
                assets: [
                  ...state.assets,
                  {
                    name: 'new.js',
                    content: '',
                    isEntry: false
                  }
                ]
              }))
            }
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
            <div class="loadState ready">Parcel is ready!</div>
          ) : (
            <div class="loadState loading">Parcel is being loaded...</div>
          )}
          {(() => {
            if (this.state.bundlingError) {
              return <ParcelError error={this.state.bundlingError} />;
            } else {
              return this.state.output ? (
                this.state.output.map(({name, content}) => (
                  <Asset
                    key={name}
                    name={name.trim()}
                    content={content}
                    additionalHeader={
                      <div class="outputSize">{filesize(content.length)}</div>
                    }
                  />
                ))
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
        </div>
      </div>
    );
  }
}

render(<App />, document.getElementById('root'));
