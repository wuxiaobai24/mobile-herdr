const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidRelease(config) {
  // EAS applies its own credential injection; the local script owns local signing.
  if (process.env.EAS_BUILD === 'true') return config;
  return withAppBuildGradle(config, config => {
    let source = config.modResults.contents;
    if (!source.includes('// Mobile Herdr release signing')) {
      source = source.replace(/signingConfigs\s*\{/, `signingConfigs {
        // Mobile Herdr release signing: credentials are supplied by the local build script.
        mobileHerdr {
            if (System.getenv('MOBILE_HERDR_ANDROID_KEYSTORE')) {
                storeFile file(System.getenv('MOBILE_HERDR_ANDROID_KEYSTORE'))
                storePassword System.getenv('MOBILE_HERDR_ANDROID_STORE_PASSWORD')
                keyAlias 'mobile-herdr'
                keyPassword System.getenv('MOBILE_HERDR_ANDROID_STORE_PASSWORD')
                storeType 'PKCS12'
            }
        }`);
      source = source.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/, '$1signingConfig signingConfigs.mobileHerdr');
    }
    config.modResults.contents = source;
    return config;
  });
};
