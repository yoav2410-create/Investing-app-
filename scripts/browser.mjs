// Resolves which Chromium the verification scripts should drive.
//
// Playwright normally finds its own browser, and on a developer's machine that
// is what should happen — `npx playwright install chromium` once and every
// script works. But these scripts were written in a container that ships a
// browser at a fixed path with downloads disabled, and hard-coding that path
// meant every script failed anywhere else with a confusing "executable doesn't
// exist" from deep inside Playwright.
//
// So: an explicit CHROME_PATH wins, a container browser is used if one is
// actually there, and otherwise Playwright resolves its own — with an error
// that says what to run rather than what is missing.

import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const CONTAINER_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function launch(options = {}) {
  const explicit = process.env.CHROME_PATH;
  if (explicit && !existsSync(explicit)) {
    throw new Error(`CHROME_PATH is set to ${explicit}, which does not exist.`);
  }
  const executablePath = explicit ?? (existsSync(CONTAINER_CHROME) ? CONTAINER_CHROME : undefined);

  try {
    return await chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
  } catch (err) {
    if (String(err).includes("Executable doesn't exist")) {
      throw new Error(
        'No Chromium available. Run:\n\n  npx playwright install chromium\n\n' +
          'or point CHROME_PATH at an existing Chrome or Chromium binary.',
      );
    }
    throw err;
  }
}
