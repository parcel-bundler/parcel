import {h, render, Component} from 'preact';
import filesize from 'filesize';

import Asset from './Asset';
import Options from './Options';
import {ParcelError, PRESETS} from './utils.js';

import fs from '@parcel/fs';
import fsNative from 'fs';

let Bundler;
setTimeout(() => (Bundler = import('./parcel-vendor').then(v => v)), 50);

const DEFAULT_PRESET = 'Javascript';

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      currentPreset: DEFAULT_PRESET,
      assets: PRESETS[DEFAULT_PRESET],
      output: [],
      bundling: false,
      bundlingError: null,
      options: {
        minify: true,
        scopeHoist: true,
        sourceMaps: false
      }
    };
  }

  async startBundling() {
    if (this.state.bundling) return;

    this.setState({bundling: true});

    try {
      fsNative.data = {};

      await fs.mkdirp('/src/');
      for (let f of this.state.assets) {
        await fs.writeFile(`/src/${f.name}`, f.content);
      }

      const entryPoints = this.state.assets
        .filter(v => v.isEntry)
        .map(v => v.name)
        .map(v => `/src/${v}`);

      if (!entryPoints.length) throw new Error('No asset marked as entrypoint');

      const bundler = new (await Bundler)(entryPoints, {
        outDir: '/dist',
        autoinstall: false,
        watch: false,
        cache: true,
        hmr: false,
        logLevel: 0,
        minify: this.state.options.minify,
        scopeHoist: this.state.options.scopeHoist,
        sourceMaps: this.state.options.sourceMaps
      });

      const bundle = await bundler.bundle();

      const output = [];
      for (let f of await fs.readdir('/dist')) {
        output.push({
          name: f,
          content: await fs.readFile('/dist/' + f, 'utf8')
        });
      }

      this.setState({bundling: false, bundlingError: null, output});
    } catch (error) {
      this.setState({bundling: false, bundlingError: error});
      console.error(error);
    }
  }

  componentDidMount() {
    document.addEventListener('keydown', e => {
      if (e.metaKey && e.code === 'Enter') this.startBundling();
    });
  }

  render() {
    // console.log(JSON.stringify(this.state.assets));
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
              onChangeName={v =>
                this.setState({
                  asset: this.state.assets.map(
                    a =>
                      a.name === name
                        ? {
                            ...a,
                            name: v
                          }
                        : a
                  )
                })
              }
              isEntry={isEntry}
              onChangeEntry={v =>
                this.setState(state => ({
                  assets: state.assets.map(
                    a =>
                      a.name === name
                        ? {
                            ...a,
                            isEntry: v
                          }
                        : a
                  )
                }))
              }
              onChangeContent={v =>
                this.setState(state => ({
                  assets: state.assets.map(
                    a =>
                      a.name === name
                        ? {
                            ...a,
                            content: v
                          }
                        : a
                  )
                }))
              }
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
          />
          <div class="file notes">
            Yes, this is Parcel as a (nearly) self-hosting bundler (self-
            <i>hoisting</i> doesn't work....)
            <br />
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
              <li>Parcel doesn't run in a worker</li>
            </ul>
            (PS: The Parcel portion of this page is a 2.1MB gzipped bundle)
          </div>
        </div>
        <div class="row">
          {this.state.bundlingError ? (
            <ParcelError>{this.state.bundlingError}</ParcelError>
          ) : (
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
          )}
        </div>
      </div>
    );
  }
}

render(<App />, document.getElementById('root'));
