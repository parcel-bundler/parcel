// @flow
import path from 'path';
import {EditableField} from './helper';
import {downloadZIP} from '../utils';

function join(a, ...b) {
  return path.join(a || '/', ...b);
}

function FileBrowserEntry({
  name,
  prefix,
  directory = false,
  isEntry,
  isEditing,
  collapsed,
  children,
  dispatch,
  ...rest
}) {
  let p = join(prefix, name);
  return (
    <li
      draggable="true"
      onDragStart={e => {
        e.dataTransfer.setData('application/x-parcel-repl-file', p);
        e.stopPropagation();
      }}
      {...rest}
    >
      <div
        className={directory ? `dir ${!collapsed ? 'expanded' : ''}` : 'file'}
        onClick={() =>
          directory
            ? dispatch({
                type: 'browser.expandToggle',
                name: p,
              })
            : dispatch({
                type: 'view.open',
                name: p,
              })
        }
        // tabIndex="0"
        // onDblclick={(e) => console.log(e)}
      >
        <div className="name">
          <div className="icon" />
          <EditableField
            value={name}
            editing={isEditing === p}
            onChange={value =>
              dispatch({
                type: 'browser.setEditing',
                value,
              })
            }
          />
        </div>
        <div className="controls">
          {!directory && (
            <input
              title="Entrypoint"
              type="checkbox"
              checked={isEntry}
              onChange={e => {
                dispatch({
                  type: 'file.isEntry',
                  name: p,
                  value: e.target.checked,
                });
                e.stopPropagation();
              }}
            />
          )}
          <button
            className="rename"
            onClick={e => {
              dispatch({
                type: 'browser.setEditing',
                name: p,
              });
              e.stopPropagation();
            }}
          />
          <button
            className="delete"
            onClick={e => {
              dispatch({
                type: 'file.delete',
                name: p,
              });
              e.stopPropagation();
            }}
          />
        </div>
      </div>
      {children}
    </li>
  );
}

function FileBrowserFolder({
  files,
  collapsed,
  dispatch,
  isEditing,
  prefix = '',
  ...props
}) {
  return (
    <ul {...props}>
      {[...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, data]) => {
          let p = join(prefix, name);
          let isCollapsed = collapsed.has(p);
          return data instanceof Map ? (
            <FileBrowserEntry
              key={name}
              directory
              name={name}
              prefix={prefix}
              dispatch={dispatch}
              isEditing={isEditing}
              collapsed={isCollapsed}
              onDrop={e => {
                const data = e.dataTransfer.getData(
                  'application/x-parcel-repl-file',
                );
                if (data != p) {
                  dispatch({
                    type: 'file.move',
                    name: data,
                    dir: p,
                  });
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onDragOver={e => e.preventDefault()}
            >
              {!isCollapsed && (
                <FileBrowserFolder
                  files={data}
                  collapsed={collapsed}
                  dispatch={dispatch}
                  isEditing={isEditing}
                  prefix={p}
                />
              )}
            </FileBrowserEntry>
          ) : (
            <FileBrowserEntry
              key={name}
              name={name}
              isEntry={!!data.isEntry}
              prefix={prefix}
              dispatch={dispatch}
              isEditing={isEditing}
            />
          );
        })}
    </ul>
  );
}

export function FileBrowser({
  files,
  collapsed,
  isEditing,
  dispatch,
  children,
}: any): any {
  return (
    <div className="file-browser">
      {children}
      <div>
        <div className="header">
          {/*<button
          onClick={async () => {
            const dirHandle = await window.showDirectoryPicker();
            for await (const entry of dirHandle.values()) {
              console.log(entry.kind, entry.name);
            }
          }}
        >
          Open
        </button>*/}
          <button onClick={() => dispatch({type: 'file.addFolder'})}>
            New Folder
          </button>
          <button onClick={() => dispatch({type: 'file.addFile'})}>
            New File
          </button>
        </div>
        <FileBrowserFolder
          files={files}
          collapsed={collapsed}
          isEditing={isEditing}
          dispatch={dispatch}
          onDrop={e => {
            const data = e.dataTransfer.getData(
              'application/x-parcel-repl-file',
            );
            dispatch({type: 'file.move', name: data, dir: ''});
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragOver={e => e.preventDefault()}
        />
        <div className="download">
          <button
            onClick={() => {
              downloadZIP(files.list());
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
