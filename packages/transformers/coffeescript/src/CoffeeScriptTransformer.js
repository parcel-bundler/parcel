import {Transformer} from '@parcel/plugin';
import coffee from 'coffeescript';

export default new Transformer({
  async transform({asset}) {
    asset.type = 'js';
    let output = coffee.compile(await asset.getCode());
    asset.setCode(output);
    return [asset];
  }
});
