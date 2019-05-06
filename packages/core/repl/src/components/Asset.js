// eslint-disable-next-line no-unused-vars
import {h} from 'preact';
// eslint-disable-next-line no-unused-vars
import Editor from './Editor';
// eslint-disable-next-line no-unused-vars
import {Box} from './helper';

const Asset = props => {
  const {
    name,
    content,
    isEntry,
    editable,
    onChangeName,
    onChangeContent,
    onChangeEntry,
    onClickRemove,
    additionalHeader
  } = props;

  if (editable) {
    return (
      <Box
        header={[
          <input
            type="text"
            class="filename"
            spellcheck="false"
            onInput={e => onChangeName(e.target.value)}
            value={name}
            aria-label="Asset filename"
          />,
          additionalHeader,
          <input
            type="checkbox"
            class="setEntry"
            title="Entrypoint"
            checked={isEntry}
            onChange={e => onChangeEntry(e.target.checked)}
          />,
          <button class="remove" onClick={() => onClickRemove(name)}>
            -
          </button>
        ]}
      >
        <Editor
          filename={name}
          content={content}
          onChange={onChangeContent}
          editable
        />
      </Box>
    );
  } else {
    return (
      <Box
        header={[
          <input type="text" class="filename" readonly value={name} />,
          additionalHeader
        ]}
      >
        <Editor filename={name} content={content} />
      </Box>
    );
  }
};

export default Asset;
