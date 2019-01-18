import ConfigResolver from '../src/ConfigResolver';
import assert from 'assert';

describe.only('ConfigResolver', () => {
  let resolver = new ConfigResolver();

  describe('validatePackageName', () => {
    it('should error on an invalid official package', () => {
      assert.throws(() => {
        resolver.validatePackageName(
          '@parcel/foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Official parcel transform packages must be named according to "@parcel\/transform-{name}" but got "@parcel\/foo-bar" in .parcelrc./);
    });

    it('should succeed on a valid official package', () => {
      resolver.validatePackageName(
        '@parcel/transform-bar',
        'transform',
        'transforms',
        '.parcelrc'
      );
    });

    it('should error on an invalid community package', () => {
      assert.throws(() => {
        resolver.validatePackageName(
          'foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Parcel transform packages must be named according to "parcel-transform-{name}" but got "foo-bar" in .parcelrc./);

      assert.throws(() => {
        resolver.validatePackageName(
          'parcel-foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Parcel transform packages must be named according to "parcel-transform-{name}" but got "parcel-foo-bar" in .parcelrc./);
    });

    it('should succeed on a valid community package', () => {
      resolver.validatePackageName(
        'parcel-transform-bar',
        'transform',
        'transforms',
        '.parcelrc'
      );
    });

    it('should error on an invalid scoped package', () => {
      assert.throws(() => {
        resolver.validatePackageName(
          '@test/foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Scoped parcel transform packages must be named according to "@test\/parcel-transform-{name}" but got "@test\/foo-bar" in .parcelrc./);

      assert.throws(() => {
        resolver.validatePackageName(
          '@test/parcel-foo-bar',
          'transform',
          'transforms',
          '.parcelrc'
        );
      }, /Scoped parcel transform packages must be named according to "@test\/parcel-transform-{name}" but got "@test\/parcel-foo-bar" in .parcelrc./);
    });

    it('should succeed on a valid scoped package', () => {
      resolver.validatePackageName(
        '@test/parcel-transform-bar',
        'transform',
        'transforms',
        '.parcelrc'
      );
    });
  });
});
