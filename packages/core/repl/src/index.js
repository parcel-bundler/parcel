import {h, render, Component} from 'preact';
import filesize from 'filesize';

import Asset from './Asset';
import Options from './Options';
import {
  ParcelError,
  presetDefault,
  presetJSON,
  fixPath,
  unfixPath
} from './utils.js';

import fs from '@parcel/fs';
let Bundler;
setTimeout(() => (Bundler = import('parcel-bundler').then(v => v)), 50);

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      assets: presetDefault,
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
      fs.memoryFSClear();

      for (let f of this.state.assets) {
        await fs.writeFile(fixPath(f.name), f.content);
      }

      const bundler = new (await Bundler)(
        this.state.assets
          .filter(v => v.isEntry)
          .map(v => v.name)
          .map(fixPath),
        {
          outDir: '/mem/dist',
          watch: false,
          cache: true,
          hmr: false,
          logLevel: 0,
          minify: this.state.options.minify,
          scopeHoist: this.state.options.scopeHoist,
          sourceMaps: this.state.options.sourceMaps
        }
      );

      const bundle = await bundler.bundle();

      const output = [];
      for (let f of await fs.readdir('/mem/dist')) {
        output.push({
          name: unfixPath(f),
          content: await fs.readFile(f)
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
