// eslint-disable-next-line no-unused-vars
import {h, Component, Fragment, createRef} from 'preact';
import path from 'path';
// eslint-disable-next-line no-unused-vars
import {Box} from './helper';

function wrapperFor(scriptURL) {
  return `<script type="application/javascript">
const console = {
  log: function() {
    document.getElementById("output").appendChild(document.createTextNode(Array.from(arguments).join(" ")+"\\n"));
  },
  warn: function() {
    console.log.apply(console, arguments);
  },
  info: function() {
    console.log.apply(console, arguments);
  },
  error: function() {
    console.log.apply(console, arguments);
  }
}
// window.onerror = function(e) {
//   console.error(e.message);
//   console.error(e.stack);
// }
</script>
<body>
Console output:<br>
<div id="output" style="font-family: monospace;white-space: pre-wrap;"></div>
</body>
<script type="application/javascript" src="${scriptURL}"></script>`;
}

export default class Preview extends Component {
  constructor(props) {
    super(props);
    // this.iframe = createRef();
  }

  shouldComponentUpdate(nextProps) {
    return nextProps.output !== this.props.output;
  }

  // componentDidUpdate() {
  //   this.iframe.current.contentWindow.location.reload();
  // }

  render() {
    return this.props.output.filter(v => v.isEntry).map(entry => {
      const entryExtension = path.extname(entry.name).slice(1);

      let url;

      if (entryExtension === 'js') {
        const data = entry.content;

        const blobURL = URL.createObjectURL(
          new Blob([data], {type: 'application/javascript'})
        );
        const wrapperPage = wrapperFor(blobURL);

        url = URL.createObjectURL(new Blob([wrapperPage], {type: 'text/html'}));
      } else if (
        entryExtension === 'html' &&
        'serviceWorker' in navigator &&
        !this.props.options.publicUrl
      ) {
        url = `${entry.name}?x=${new Date().getTime()}#parcel_preview`;
      }

      if (url) {
        return (
          <Box header={'Preview: ' + entry.name}>
            <iframe class="preview" src={url} />
          </Box>
        );
      }
    });
  }
}
