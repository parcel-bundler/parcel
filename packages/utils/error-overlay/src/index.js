/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-env browser */
/* eslint-disable react/react-in-jsx-scope, no-console */
/* @flow */
import type {ErrorRecord} from './listenToRuntimeErrors';
import {listenToRuntimeErrors, crashWithFrames} from './listenToRuntimeErrors';
import {render} from 'preact';
import RuntimeErrorContainer from './containers/RuntimeErrorContainer';
import {overlayStyle} from './styles';

type RuntimeReportingOptions = {|
  onError: () => void,
  filename?: string,
|};

export type ErrorLocation = {|
  fileName: string,
  lineNumber: number,
  colNumber?: number,
|};

type EditorHandler = (errorLoc: ErrorLocation) => void;

let iframe: null | HTMLIFrameElement = null;

let editorHandler: null | EditorHandler = null;
let currentRuntimeErrorRecords: Array<ErrorRecord> = [];
let stopListeningToRuntimeErrors: null | (() => void) = null;

export function setEditorHandler(handler: EditorHandler | null) {
  editorHandler = handler;
  if (iframe) {
    update();
  }
}

export function reportRuntimeError(
  error: Error,
  options: RuntimeReportingOptions,
) {
  crashWithFrames(handleRuntimeError(options))(error, false);
}

export function startReportingRuntimeErrors(options: RuntimeReportingOptions) {
  if (stopListeningToRuntimeErrors !== null) {
    throw new Error('Already listening');
  }
  stopListeningToRuntimeErrors = listenToRuntimeErrors(
    handleRuntimeError(options),
  );
}

const handleRuntimeError =
  (options: RuntimeReportingOptions) => (errorRecord: ErrorRecord) => {
    try {
      if (typeof options.onError === 'function') {
        options.onError.call(null);
      }
    } finally {
      if (
        currentRuntimeErrorRecords.some(
          ({error}) => error === errorRecord.error,
        )
      ) {
        // Deduplicate identical errors.
        // This fixes https://github.com/facebook/create-react-app/issues/3011.
        // eslint-disable-next-line no-unsafe-finally
        return;
      }
      currentRuntimeErrorRecords = currentRuntimeErrorRecords.concat([
        errorRecord,
      ]);
      update();
    }
  };

export function dismissRuntimeErrors() {
  currentRuntimeErrorRecords = [];
  update();
}

export function stopReportingRuntimeErrors() {
  if (stopListeningToRuntimeErrors === null) {
    throw new Error('Not currently listening');
  }
  try {
    stopListeningToRuntimeErrors();
  } finally {
    stopListeningToRuntimeErrors = null;
  }
}

let rootNode, shadow;

function update() {
  if (!rootNode) {
    rootNode = document.createElement('parcel-error-overlay');
    shadow = rootNode.attachShadow({mode: 'open'});
    if (rootNode) {
      document.body?.appendChild(rootNode);
    }
  }

  if (currentRuntimeErrorRecords.length > 0 && shadow) {
    render(
      <dialog
        ref={d => (d: any)?.showModal()}
        style={overlayStyle}
        onClose={dismissRuntimeErrors}
      >
        <ErrorOverlay />
      </dialog>,
      shadow,
    );
  } else {
    rootNode?.remove();
    rootNode = null;
  }
}

function ErrorOverlay() {
  if (currentRuntimeErrorRecords.length > 0) {
    return (
      <RuntimeErrorContainer
        errorRecords={currentRuntimeErrorRecords}
        close={dismissRuntimeErrors}
        editorHandler={editorHandler}
      />
    );
  }
  return null;
}

if (process.env.NODE_ENV === 'production') {
  console.warn(
    'react-error-overlay is not meant for use in production. You should ' +
      'ensure it is not included in your build to reduce bundle size.',
  );
}
