import {h, render, Component} from 'preact';
import Asset from './Asset';

import fs from '@parcel/fs';
let Bundler;
setTimeout(() => (Bundler = import('parcel-bundler').then(v => v)), 1);

function fixPath(f) {
  return '/mem/' + f;
}
function unfixPath(f) {
  return f.replace(/^\/mem\//, '');
}

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      assets: [
        // {
        // 	name: 'index.js',
        // 	content: `import {a, x} from "./other.js";\nconsole.log(x);`,
        // 	isEntry: true
        // },
        // 				{
        // 					name: 'other.js',
        // 					content: `function a(){
        //   return "asd";
        // }
        // const x = 123;
        // export {a, x};`
        // 				}

        {
          name: 'index.js',
          content: "import x from './test.json';\nconsole.log(x);",
          isEntry: true
        },
        {name: 'test.json', content: '{a: 2, b: 3}'}
      ],
      output: [],
      bundling: false,
      options: {
        minify: true,
        scopeHoist: true
      }
    };
  }

  async startBundling() {
    this.setState({bundling: true});

    const output = [];
    try {
      fs.memoryFSClear();

      for (let f of this.state.assets) {
        await fs.writeFile(fixPath(f.name), f.content);
      }

      // console.log(Bundler);
      const bundler = new (await Bundler)(
        this.state.assets
          .filter(v => v.isEntry)
          .map(v => v.name)
          .map(fixPath),
        {
          outDir: '/mem/dist',
          watch: false,
          cache: false,
          minify: this.state.options.minify,
          scopeHoist: this.state.options.scopeHoist,
          hmr: false,
          sourceMaps: false,
          logLevel: 0
        }
      );

      const bundle = await bundler.bundle();

      for (let f of await fs.readdir('/mem/dist')) {
        output.push({
          name: unfixPath(f),
          content: await fs.readFile(f)
        });
      }
    } catch (e) {
      throw e;
    } finally {
      this.setState({bundling: false, output});
    }
  }

  render() {
    // console.log(JSON.stringify(this.state.assets));
    return (
      <div id="app">
        <div class="row">
          {this.state.assets.map(({name, content, isEntry}) => (
            <Asset
              editable
              key="name"
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
          <div class="options file">
            <label>
              Minify
              <input
                type="checkbox"
                checked={this.state.options.minify}
                onChange={e =>
                  this.setState(state => ({
                    options: {
                      ...state.options,
                      minify: e.target.checked
                    }
                  }))
                }
              />
            </label>
            <label>
              Experimental scope hoisting
              <input
                type="checkbox"
                checked={this.state.options.scopeHoist}
                onChange={e =>
                  this.setState(state => ({
                    options: {
                      ...state.options,
                      scopeHoist: e.target.checked
                    }
                  }))
                }
              />
            </label>
          </div>
        </div>
        <div class="row">
          {this.state.output.map(({name, content}) => (
            <Asset key={name} name={name.trim()} content={content} />
          ))}
        </div>
      </div>
    );
  }
}

render(<App />, document.getElementById('root'));

if (module.hot) module.hot.accept();
