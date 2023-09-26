// @flow
import {convertSourceLocationToHighlight, Diagnostic} from '../src/diagnostic';
import {AssetDiagnostic} from '../src/diagnostic';
import {remapSourceLocation} from '@parcel/utils';

const SCRIPT_ERRORS = {
  browser: {
    message: 'Browser scripts cannot have imports or exports.',
    hint: 'Add the type="module" attribute to the <script> tag.',
  },
  'web-worker': {
    message:
      'Web workers cannot have imports or exports without the `type: "module"` option.',
    hint: "Add {type: 'module'} as a second argument to the Worker constructor.",
  },
  'service-worker': {
    message:
      'Service workers cannot have imports or exports without the `type: "module"` option.',
    hint: "Add {type: 'module'} as a second argument to the navigator.serviceWorker.register() call.",
  },
};

export const FIX_TYPE_MODULE_JS = (err, loc) => {
  return [
    {
      type: 'patch',
      message: err.hint,
      filePath: loc.filePath,
      hash: '',
      edits: [
        {
          range: {
            start: {
              line: loc.end.line,
              column: loc.end.column - 1,
            },
            end: loc.end,
          },
          replacement: ", {type: 'module'}",
        },
      ],
    },
  ];
};

export const FIX_TYPE_MODULE_HTML = (err, loc) => {
  return [
    {
      type: 'patch',
      message: err.hint,
      filePath: loc.filePath,
      hash: '',
      edits: [
        {
          range: {
            start: {
              line: loc.start.line,
              column: loc.start.column + '<script '.length,
            },
            end: loc.end,
          },
          replacement: `type="module" `,
        },
      ],
    },
  ];
};

export const convertDiagnostic = (diagnostic: AssetDiagnostic): Diagnostic => {
  let {asset, originalMap} = diagnostic;

  let convertLoc = (loc): SourceLocation => {
    let location = {
      filePath: asset.filePath,
      start: {
        line: loc.start_line + Number(asset.meta.startLine ?? 1) - 1,
        column: loc.start_col,
      },
      end: {
        line: loc.end_line + Number(asset.meta.startLine ?? 1) - 1,
        column: loc.end_col,
      },
    };

    // If there is an original source map, use it to remap to the original source location.
    if (originalMap) {
      location = remapSourceLocation(location, originalMap);
    }

    return location;
  };

  let message = diagnostic.message;
  if (message === 'SCRIPT_ERROR') {
    let err = SCRIPT_ERRORS[(asset.env.context: string)];
    message = err?.message || SCRIPT_ERRORS.browser.message;
  }

  let res: Diagnostic = {
    message,
    codeFrames: [
      {
        filePath: asset.filePath,
        codeHighlights: diagnostic.code_highlights?.map(highlight =>
          convertSourceLocationToHighlight(
            convertLoc(highlight.loc),
            highlight.message ?? undefined,
          ),
        ),
      },
    ],
    hints: diagnostic.hints,
  };

  if (diagnostic.documentation_url) {
    res.documentationURL = diagnostic.documentation_url;
  }

  if (diagnostic.show_environment) {
    if (asset.env.loc && asset.env.loc.filePath !== asset.filePath) {
      res.codeFrames?.push({
        filePath: asset.env.loc.filePath,
        codeHighlights: [
          convertSourceLocationToHighlight(
            asset.env.loc,
            'The environment was originally created here',
          ),
        ],
      });
    }

    let err = SCRIPT_ERRORS[(asset.env.context: string)];
    if (err) {
      let loc = asset.env.loc;
      if (!res.hints && loc) {
        if (loc.filePath.endsWith('js')) {
          res.fixes = FIX_TYPE_MODULE_JS(err, loc);
        } else if (loc.filePath.endsWith('html')) {
          res.fixes = FIX_TYPE_MODULE_HTML(err, loc);
        }
      } else {
        res.hints.push(err.hint);
      }
    }
  }

  return res;
};
