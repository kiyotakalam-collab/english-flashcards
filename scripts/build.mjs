import { WRITING_BANK_RELEASE } from '../writing-bank-manifest.js';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const assets = ['index.html', 'portal.html', 'usage.html', 'usage.css', 'usage.js', 'usage-core.js', 'usage-data.js', 'writing.html', 'writing.js', 'writing-ai.js', 'writing-bank.js', 'writing-bank-import.js', 'writing-bank-loader.js', 'writing-bank-manifest.js', ...WRITING_BANK_RELEASE.files, 'writing.css', 'writing-core.js', 'writing-data.js', 'refresh.html', 'addition-dates.html', 'addition-dates.js', 'addition-date-recovery.html', 'addition-date-recovery.js', 'styles.css', 'app.js', 'listening.js', 'listening-ui.js', 'listening.css', 'core.js', 'repetition.js', 'review-ui.js', 'initial_words.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist/icons', { recursive: true });
const hash = createHash('sha256');
for (const path of [...assets, 'sw.js']) hash.update(await readFile(path));
const version = hash.digest('hex').slice(0, 16);
for (const path of [...assets, 'flashcard_mistake_tracker_1-1200.html']) {
  await mkdir(`dist/${path.split('/').slice(0,-1).join('/')}`, { recursive: true });
  await copyFile(path, `dist/${path}`);
}
await writeFile('dist/sw.js', (await readFile('sw.js', 'utf8')).replace('__BUILD_VERSION__', version).replace('/* WRITING_BANK_ASSETS */ []', JSON.stringify(['./writing-bank-loader.js', './writing-bank-manifest.js', ...WRITING_BANK_RELEASE.files.map(p=>'./'+p)])));
await writeFile('dist/.nojekyll', '');
console.log(`Built dist/ (offline cache ${version})`);
