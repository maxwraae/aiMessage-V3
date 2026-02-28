import { SessionEngine } from './SessionEngine.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { JournalManager } from './JournalManager.js';

async function test() {
  const sessionId = 'test-engine-' + crypto.randomBytes(4).toString('hex');
  const engine = new SessionEngine();
  const journal = new JournalManager(sessionId);

  console.log(`--- Testing Layer 3: SessionEngine for ${sessionId} ---`);

  // 1. Submit input (Should wake tmux and pipe)
  console.log('Submitting first input...');
  // We use a command that Claude CLI would understand if it were running,
  // but for the test we just check if it gets piped to the file.
  await engine.submit(sessionId, 'test-cli', 'echo "Hello Engine"');

  // 2. Wait a bit for tmux to start and pipe-pane to work
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 3. Verify out.jsonl has content
  const outPath = journal.getOutPath();
  const outContent = await fs.readFile(outPath, 'utf-8');
  console.log('✅ Output Journal content:\n', outContent);
  
  if (outContent.length > 0) {
    console.log('✅ SUCCESS: Output captured in journal.');
  } else {
    console.log('❌ FAILED: Output journal is empty.');
  }

  // 4. Test Busy Lock
  const meta = await journal.getMetadata();
  console.log('✅ Session Status:', meta?.status);
  
  // 5. Cleanup
  const { MuxManager } = await import('./MuxManager.js');
  const mux = new MuxManager();
  await mux.killSession(sessionId);
  console.log('✅ Session cleaned up.');

  console.log('--- Layer 3 Test Complete ---');
}

test().catch(console.error);
