import fs from 'node:fs';
import { QUESTIONS, GRAMMAR, DIFFICULTIES } from '../writing-data.js';
import { loadBundledQuestions } from '../writing-bank-loader.js';
import { createState } from '../writing-core.js';
import { BANK_TARGET, bankCount, createPromptIndex } from '../writing-bank.js';
import { WRITING_BANK_RELEASE } from '../writing-bank-manifest.js';

const fetcher = async url => ({ok: true, text: async () => fs.readFileSync(url, 'utf8')});
const questions = await loadBundledQuestions(QUESTIONS, {fetcher});
const state = createState(questions);
const index = createPromptIndex();
const duplicates = [];
for (const q of questions) {
  if (index.has(q.japanese)) duplicates.push(q.id);
  index.add(q.japanese);
}

const addedPerCell = new Map();
for (const file of WRITING_BANK_RELEASE.files.filter(file => file.startsWith('writing-bank-data/fill-'))) {
  for (const row of JSON.parse(fs.readFileSync(file, 'utf8')).questions) {
    const key = `${row.grammar}/${row.difficulty}`;
    addedPerCell.set(key, (addedPerCell.get(key) ?? 0) + 1);
  }
}
const cells = GRAMMAR.flatMap(g => DIFFICULTIES.map(d => {
  const registered = bankCount(state, g.id, d.id);
  const generated = addedPerCell.get(`${g.id}/${d.id}`) ?? 0;
  return {
    grammar: g.id, label: g.label, difficulty: d.id,
    github_before: registered - generated, generated, registered,
    device_registered: null, missing: Math.max(0, BANK_TARGET - registered)
  };
}));
const report = {
  release: WRITING_BANK_RELEASE.id,
  registered: questions.filter(q => q.mode === 'short').length,
  target: WRITING_BANK_RELEASE.target,
  missing: cells.reduce((n, cell) => n + cell.missing, 0),
  duplicates,
  cells
};
if (duplicates.length || WRITING_BANK_RELEASE.complete !== (report.missing === 0)) {
  throw Error(JSON.stringify({duplicates, missing: report.missing, complete: WRITING_BANK_RELEASE.complete}));
}
fs.writeFileSync('docs/writing-bank/inventory.json', JSON.stringify(report, null, 2) + '\n');
const fields = ['grammar', 'label', 'difficulty', 'github_before', 'generated', 'registered', 'missing'];
fs.writeFileSync('docs/writing-bank/inventory.csv', '\ufeff' + fields.join(',') + '\n' +
  cells.map(cell => fields.map(field => cell[field]).join(',')).join('\n') + '\n');
console.log(JSON.stringify({...report, cells: undefined}));
