import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Compile exactly the deployable worker, then exercise it under workerd.
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run',
  '--config', 'server/ai/wrangler.jsonc', '--outdir', resolve('.wrangler/ai-check')], { stdio: 'inherit' });
execFileSync(process.execPath, ['--test', 'tests/runtime/ai-worker.test.js'], { stdio: 'inherit' });
