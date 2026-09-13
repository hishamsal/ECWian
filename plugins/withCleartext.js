const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = manifest.manifest.application;
    const app = Array.isArray(application) ? application[0] : application;
    app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
