const { withAndroidManifest } = require('expo/config-plugins');
module.exports = function withLocalNetwork(config) {
  return withAndroidManifest(config, config => {
    config.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return config;
  });
};
