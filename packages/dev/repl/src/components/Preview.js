// @flow
// @jsx h
/* eslint-disable react/jsx-no-bind */
// eslint-disable-next-line no-unused-vars
import {h, Fragment} from 'preact';
import {useRef, useState} from 'preact/hooks';
import {usePromise} from './helper';

export function Preview({clientID}: {|clientID: Promise<string>|}): any {
  let [clientIDResolved] = usePromise(clientID);
  let url =
    clientIDResolved && `/__repl_dist/index.html?parentId=${clientIDResolved}`;
  let [popover, setPopover] = useState(null);

  const iframeRef = useRef();

  // TODO disable preview if options.publicURL !== '/__repl_dist'

  return (
    url && (
      <div class="preview">
        <div class="controls">
          {!popover && (
            <button
              onClick={() => {
                let w = window.open(url);
                // window.open(url, '_blank', 'toolbar=0,location=0,menubar=0'),
                setPopover(w);
                w.onload = function () {
                  this.onbeforeunload = function () {
                    setPopover(null);
                  };
                };
              }}
              disabled={!url}
            >
              Move to new window
            </button>
          )}
          {popover && (
            <button
              onClick={() => {
                popover.close();
                setPopover(null);
              }}
              disabled={!url}
            >
              Close popover
            </button>
          )}
          {!popover && (
            <button
              class="reload"
              // $FlowFixMe
              onClick={() => (iframeRef.current.src = url)}
            >
              Reload
            </button>
          )}
        </div>
        {!popover && (
          //<Box>
          <iframe ref={iframeRef} src={url} />
          //</Box>
        )}
      </div>
    )
  );
}
