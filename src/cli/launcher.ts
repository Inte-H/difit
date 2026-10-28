#!/usr/bin/env node

// Hands the run to the newest complete copy under ~/.difit/versions when it is
// newer than this one. Keep its imports to modules without side effects: a
// handed-off run must load only the newer copy's code.
import { fileURLToPath } from 'node:url';

import pkg from '../../package.json' with { type: 'json' };

import { launchNewestCopy } from './versions.js';

await launchNewestCopy({
  selfVersion: pkg.version,
  ownEntry: fileURLToPath(new URL('./index.js', import.meta.url)),
  runOwnCli: () => import('./index.js'),
});
