// @flow
// @jsx h
// eslint-disable-next-line no-unused-vars
import {h, Component, Fragment, createRef} from 'preact';
// import path from 'path';
import {Box} from './helper';

function wrapperFor(script) {
  return `<script type="application/javascript">
window.console = {
  log: function() {
    var content = Array.from(arguments)
      .map(v => (typeof v === "object" ? JSON.stringify(v) : v))
      .join(" ");
    document
      .getElementById("output")
      .appendChild(document.createTextNode(content + "\\n"));
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
};
window.onerror = function(e) {
  console.error(e.message);
  console.error(e.stack);
}
</script>
<body>
Console output:<br>
<div id="output" style="font-family: monospace;white-space: pre-wrap;"></div>
</body>
<script type="application/javascript">
// try{
${script}
// } catch(e){
//   console.error(e.message);
//   console.error(e.stack);
// }
</script>`;
}

export default class Preview extends Component {
  constructor(props: any) {
    super(props);
    // this.iframe = createRef();
  }

  // shouldComponentUpdate(nextProps) {
  //   return nextProps.output !== this.props.output;
  // }

  // componentDidUpdate() {
  //   this.iframe.current.contentWindow.location.reload();
  // }

  render(): any {
    return (
      this.props.output
        // .filter(v => v.isEntry)
        .map(entry => {
          let url;

          if (entry.name.endsWith('js')) {
            const data = entry.content;

            const wrapperPage = wrapperFor(data);
            // const blobURL = URL.createObjectURL(
            //   new Blob([data], {type: 'application/javascript'}),
            // );
            // const wrapperPage = wrapperFor(blobURL);

            url = URL.createObjectURL(
              new Blob([wrapperPage], {type: 'text/html'}),
            );
            // } else if (
            //   entryExtension === 'html' &&
            //   'serviceWorker' in navigator &&
            //   !this.props.options.publicUrl
            // ) {
            //   url = `${entry.name}?x=${new Date().getTime()}#parcel_preview`;
          }

          if (url) {
            return (
              <Box header={'Preview: ' + entry.name}>
                <iframe class="preview" src={url} />
              </Box>
            );
          }
        })
    );
  }
}
