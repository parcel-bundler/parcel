// @flow
import {useRef, useState} from 'react';
import {usePromise} from './helper';

export function Preview({clientID}: {|clientID: Promise<string>|}): any {
  let [clientIDResolved] = usePromise(clientID);
  let url =
    clientIDResolved && `/__repl_dist/index.html?parentId=${clientIDResolved}`;
  let [popover, setPopover] = useState(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // TODO disable preview if options.publicURL !== '/__repl_dist'

  return (
    url && (
      <div className="preview">
        <div className="controls">
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
              className="reload"
              // $FlowFixMe
              onClick={() => (iframeRef.current.src = url)}
            >
              Reload
            </button>
          )}
        </div>
        {!popover && (
          //<Box>
          <iframe title="Preview" ref={iframeRef} src={url} />
          //</Box>
        )}
      </div>
    )
  );
}
