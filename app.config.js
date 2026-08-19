const base = require('./app.json');

/**
 * The static config lives in app.json; this file adds the one thing that has to
 * be decided at build time.
 *
 * GitHub Pages serves a project site from `/<repo-name>/`, not from the domain
 * root. Every script, stylesheet and image reference in the exported site has
 * to carry that prefix or the page loads a blank screen with 404s in the
 * console. Expo bakes the prefix in at export time from `experiments.baseUrl`,
 * so it cannot be a runtime setting.
 *
 * Set EXPO_PUBLIC_BASE_URL for a subpath deploy; leave it unset everywhere else
 * — native builds and `expo start` must not have it.
 */
module.exports = () => {
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL;
  if (!baseUrl) return base;

  const normalised = '/' + baseUrl.replace(/^\/+|\/+$/g, '');
  return {
    ...base,
    expo: {
      ...base.expo,
      experiments: { ...base.expo.experiments, baseUrl: normalised },
    },
  };
};
