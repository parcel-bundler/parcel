// @flow
import {Transformer} from '@parcel/plugin';
import invariant from 'assert';

// From 'react-native-reanimated/plugin.js'
const REGEX =
  /useFrameCallback|useAnimatedStyle|useAnimatedProps|createAnimatedPropAdapter|useDerivedValue|useAnimatedScrollHandler|useAnimatedReaction|useWorkletCallback|withTiming|withSpring|withDecay|withRepeat|useAnimatedGestureHandler|useAnimatedScrollHandler|"worklet"|'worklet'/;

export default (new Transformer({
  async transform({asset}) {
    let code = await asset.getCode();
    if (REGEX.test(code)) {
      asset.meta.babelPlugins ??= [];
      invariant(Array.isArray(asset.meta.babelPlugins));
      // TODO relative to where?
      asset.meta.babelPlugins.push('react-native-reanimated/plugin');
    }
    return [asset];
  },
}): Transformer);
