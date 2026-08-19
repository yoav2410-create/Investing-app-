// Stands in for Node's standard library when Metro bundles for a device.
// See metro.config.js for why this is needed at all.
//
// Deliberately empty rather than throwing on access: several of these
// specifiers are imported at the top of a module whose Node-only functions are
// never called, so throwing would break the bundle at startup on behalf of code
// that is only ever dead weight on a phone. Anything that genuinely tried to
// read a file here would fail at its own call site, which is where the mistake
// would actually be.
module.exports = {};
