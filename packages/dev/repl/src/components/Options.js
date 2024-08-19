// @flow
import type {State} from './';
import type {REPLOptions} from '../utils';

import fs from 'fs';
import path from 'path';

import {getDefaultTargetEnv} from '../utils';

let commit = fs
  .readFileSync(path.join(__dirname, '../../commit'), 'utf8')
  .trim();

export function Options({
  state,
  dispatch,
  disabled = false,
}: {|
  state: State,
  dispatch: ({|
    type: 'options',
    name: $Keys<REPLOptions>,
    value: mixed,
  |}) => void,
  disabled: ?boolean,
|}): any {
  const values: REPLOptions = state.options;
  const onChange = (name: $Keys<REPLOptions>, value: mixed) =>
    dispatch({type: 'options', name, value});

  // TODO disabled when watching

  const disablePackageJSON = state.files.has('/package.json');

  return (
    <div className="options">
      <label title="Corresponds to `--no-source-maps`">
        <span>Source Maps</span>
        <input
          type="checkbox"
          checked={values.sourceMaps}
          disabled={values.viewSourcemaps || disabled}
          onChange={e => onChange('sourceMaps', e.target.checked)}
        />
      </label>
      <label title="Sets `--public-url <value>`">
        <span>Public URL</span>
        <input
          type="text"
          value={values.publicUrl}
          placeholder="/"
          onInput={e => onChange('publicUrl', e.target.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>Output Format</span>
        <select
          onChange={e => onChange('outputFormat', e.target.value || null)}
          value={values.outputFormat ?? ''}
          disabled={disabled || disablePackageJSON}
        >
          <option value="" />
          <option value="esmodule">esmodule</option>
          <option value="commonjs">commonjs</option>
          <option value="global">global</option>
        </select>
      </label>
      <label>
        <span>Target</span>
        <div>
          <select
            onChange={e => {
              onChange('targetType', e.target.value);
              onChange('targetEnv', null);
            }}
            value={values.targetType}
            style={{marginRight: '0.5rem'}}
            disabled={disabled || disablePackageJSON}
          >
            <option value="browsers">Browsers</option>
            <option value="node">Node</option>
          </select>
          <input
            type="text"
            value={values.targetEnv ?? ''}
            onInput={e => onChange('targetEnv', e.target.value || null)}
            placeholder={getDefaultTargetEnv(values.targetType)}
            disabled={disabled || disablePackageJSON}
          />
        </div>
      </label>
      <label>
        <span>Mode</span>
        <select
          onChange={e => {
            onChange('mode', e.target.value || null);
            if (e.target.value === 'production') {
              onChange('hmr', false);
            } else {
              onChange('scopeHoist', false);
              onChange('minify', false);
            }
          }}
          value={values.mode}
          disabled={disabled}
        >
          <option value="production">production</option>
          <option value="development">development</option>
        </select>
      </label>
      <label>
        <span>HMR</span>
        <input
          type="checkbox"
          checked={values.hmr}
          onChange={e => onChange('hmr', e.target.checked)}
          disabled={disabled || values.mode === 'production'}
        />
      </label>
      <label title="Sets `--no-minify`">
        <span>Minify</span>
        <input
          type="checkbox"
          checked={values.minify}
          onChange={e => onChange('minify', e.target.checked)}
          disabled={disabled || values.mode === 'development'}
        />
      </label>
      <label title="Corresponds to `--no-scope-hoist`">
        <span>Enable Scope Hoisting</span>
        <input
          type="checkbox"
          checked={values.scopeHoist}
          onChange={e => onChange('scopeHoist', e.target.checked)}
          disabled={disabled || values.mode === 'development'}
        />
      </label>
      <hr />
      <label title="env variable ATLASPACK_DUMP_GRAPHVIZ">
        <span>Render Graphs</span>
        <select
          onChange={e => onChange('renderGraphs', e.target.value || null)}
          value={values.renderGraphs}
          disabled={disabled}
        >
          <option value="">disabled</option>
          <option value="true">enabled</option>
          <option value="symbols">enabled with symbols</option>
        </select>
      </label>
      <hr />
      <div className="dependencies">
        Dependencies
        <ul>
          {values.dependencies?.map(([name, version], i) => (
            <li key={i}>
              <input
                type="text"
                value={name}
                placeholder="pkg-name"
                onInput={e =>
                  onChange(
                    'dependencies',
                    values.dependencies.map((v, j) =>
                      j === i ? [e.target.value, v[1]] : v,
                    ),
                  )
                }
                disabled={disabled || disablePackageJSON}
              />
              @
              <input
                value={version}
                placeholder="range"
                onInput={e =>
                  onChange(
                    'dependencies',
                    values.dependencies.map((v, j) =>
                      j === i ? [v[0], e.target.value] : v,
                    ),
                  )
                }
                disabled={disabled || disablePackageJSON}
              />
              <button
                className="remove"
                onClick={() =>
                  onChange(
                    'dependencies',
                    values.dependencies.filter((_, j) => j !== i),
                  )
                }
                disabled={disabled || disablePackageJSON}
              >
                ✕
              </button>
            </li>
          ))}
          <li>
            <button
              className="add"
              onClick={() =>
                onChange('dependencies', [...values.dependencies, ['', '']])
              }
              disabled={disabled || disablePackageJSON}
            >
              Add
            </button>
          </li>
        </ul>
      </div>
      <hr />
      <label title="env variable ATLASPACK_WORKERS">
        <span>Workers</span>
        <select
          onChange={e => onChange('numWorkers', JSON.parse(e.target.value))}
          value={JSON.stringify(values.numWorkers)}
          disabled={disabled}
        >
          <option value="0">Use no nested workers</option>
          {navigator.hardwareConcurrency > 0 &&
            new Array(navigator.hardwareConcurrency / 2).fill(0).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                Use {i + 1} nested workers
              </option>
            ))}
          <option value="null">Default</option>
        </select>
      </label>
      <div>
        Based on commit{' '}
        <a href={`https://github.com/parcel-bundler/parcel/commits/${commit}`}>
          {commit.substr(0, 10)}
        </a>
      </div>
    </div>
  );
}
