// eslint-disable-next-line no-unused-vars
import {h, Component, Fragment} from 'preact';
import path from 'path';

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
  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.output !== this.props.output;
  }

  render() {
    const {assets, output} = this.props;
    const entryName = assets.find(v => v.isEntry).name;
    const entryExtension = path.extname(entryName).slice(1);
    const entryOutput = output.find(v => v.name === entryName);

    if (entryExtension === 'js') {
      let data = entryOutput.content;

      const blobURL = URL.createObjectURL(
        new Blob([data], {type: 'application/javascript'})
      );

      const wrapperPage = wrapperFor(blobURL);
      return (
        <Fragment>
          Preview (of the first entry point): <br />
          <iframe
            class="file preview"
            src={URL.createObjectURL(
              new Blob([wrapperPage], {type: 'text/html'})
            )}
          />
        </Fragment>
      );
    } else if (entryExtension === 'html') {
      // TODO free blob
      // let data = entryOutput.content;
      // console.log(output);
      // for(const f of output.map(v => v.name !== entryName)) {
      //   const blobURL = URL.createObjectURL(new Blob([f.content], {type : 'application/octet-stream'}));
      //   console.log(f);
      //   data = data.split("/"+f.name).join(blobURL);
      // }
      // const blobURL = URL.createObjectURL(new Blob([entryOutput.content], {type : 'text/html'}))
      // return <iframe src={blobURL}/>
    }

    return false;
  }
}
