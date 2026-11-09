import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const assets = ['index.html', 'styles.css', 'app.js', 'core.js', 'initial_words.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist/icons', { recursive: true });
const hash = createHash('sha256');
for (const path of [...assets, 'sw.js']) hash.update(await readFile(path));
const version = hash.digest('hex').slice(0, 16);
for (const path of [...assets, 'flashcard_mistake_tracker_1-1200.html']) await copyFile(path, `dist/${path}`);
await writeFile('dist/sw.js', (await readFile('sw.js', 'utf8')).replace('__BUILD_VERSION__', version));
await writeFile('dist/.nojekyll', '');
console.log(`Built dist/ (offline cache ${version})`);
