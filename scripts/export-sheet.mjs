import { readFile, writeFile } from 'node:fs/promises';
const words = JSON.parse(await readFile('initial_words.json', 'utf8'));
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const rows = [['id', 'word', 'meaning', 'range', 'active', 'updated_at', 'sources'], ...words.map(word => [word.id, word.word, word.meaning, '', 'TRUE', '', word.sources || ''])];
await writeFile('initial_words.csv', '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
console.log(`initial_words.csv: ${words.length} words (original IDs preserved)`);
