const { withGradleProperties } = require('expo/config-plugins');

const COMPRESSION_PROPS = [
  { key: 'expo.useLegacyPackaging', value: 'true' },
  { key: 'android.enableBundleCompression', value: 'true' },
  { key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
  { key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' },
  { key: 'expo.gif.enabled', value: 'false' },
  { key: 'expo.webp.enabled', value: 'false' },
];

function withApkCompression(config) {
  return withGradleProperties(config, (cfg) => {
    for (const { key, value } of COMPRESSION_PROPS) {
      const existing = cfg.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    }
    return cfg;
  });
}

module.exports = withApkCompression;
