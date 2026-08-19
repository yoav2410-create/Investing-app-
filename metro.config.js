// Metro needs one rule this project cannot get from the Expo defaults.
//
// @anthropic-ai/sdk carries Node-only code paths — a credential chain that
// reads an API key off disk, helpers that spawn a child process — none of which
// this app reaches. The key comes from the keychain (`src/data/keys.ts`) and the
// only thing used from the SDK is its HTTP client. But Metro resolves every
// import it can see, whether or not the code runs, and React Native ships no
// Node standard library, so `node:fs` inside the SDK failed the *entire* native
// bundle with "Unable to resolve module node:fs".
//
// The web export was never affected, which is why this stayed invisible: the
// verification suite drives the web build, so a green suite says nothing about
// whether the app can start in Expo Go.
//
// Native only. Web resolves these itself, and the rule here is about what a
// device lacks, not about what the SDK ought to do.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const NODE_BUILTIN_STUB = path.join(__dirname, 'scripts', 'node-builtin-stub.js');
const inherited = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && moduleName.startsWith('node:')) {
    return { type: 'sourceFile', filePath: NODE_BUILTIN_STUB };
  }
  return (inherited ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
