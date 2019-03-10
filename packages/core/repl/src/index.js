import {h, render, Component, Fragment} from 'preact';
import filesize from 'filesize';

import Asset from './components/Asset';
import Options from './components/Options';
import {ParcelError, PRESETS, hasBrowserslist} from './utils';
import bundle from './bundle';

const DEFAULT_PRESET = 'Javascript';

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      currentPreset: DEFAULT_PRESET,
      assets: PRESETS[DEFAULT_PRESET],
      output: null,
      bundling: false,
      bundlingError: null,
      options: {
        minify: true,
        scopeHoist: true,
        sourceMaps: false,
        browserslist: 'Chrome 70'
      }
    };
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
              editable
              key={name}
              name={name}
              content={content}
              onChangeName={v => this.updateAsset(name, 'name', v)}
              isEntry={isEntry}
              onChangeEntry={v => this.updateAsset(name, 'isEntry', v)}
              onChangeContent={v => this.updateAsset(name, 'content', v)}
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
          <div class="file notes">
            Yes, this is Parcel as a (nearly) self-hosting bundler (self-
            <i>hoisting</i> doesn't work ...)<br />
            (PS: The Parcel portion of this page, including all compilers, is a
            2MB gzipped bundle running in a Web Worker)<br />
            <br />
            Known issues:
            <ul>
              <li>
                Minifying CSS doesn't work (runtime <code>require</code> calls
                by cssnano, even for the config to disable the corresponding
                plugin...)
              </li>
              <li>
                Node builtin modules can't be polyfilled for the browser (the
                page freezes)
              </li>
              <li>
                Babel would need to <code>require</code> plugins at runtime (at
                least without workarounds)
              </li>
            </ul>
          </div>
        </div>
        <div class="row">
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
