import {Namer} from '@parcel/plugin';

export default new Namer({
  name(bundle) {
    return `bundle.${bundle.type}`;
  }
});
