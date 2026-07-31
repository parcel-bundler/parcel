import {Transformer} from '@parcel/plugin';

export default new Transformer({
  transform({asset}) {
    return [asset];
  },
});
