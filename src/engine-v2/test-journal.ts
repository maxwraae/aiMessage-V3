import { JournalManager } from './JournalManager.js';
import * as crypto from 'node:crypto';

async function test() {
  const sessionId = 'test-session-' + crypto.randomBytes(4).toString('hex');
  const journal = new JournalManager(sessionId);

  console.log(`--- Testing Layer 1: Journal for ${sessionId} ---`);

  // 1. Ensure Storage
  await journal.ensureStorage();
  console.log('✅ Storage initialized.');

  // 2. Multi-client append simulation
  console.log('Simulating concurrent inputs from 3 devices...');
  const devices = ['iphone-max', 'macbook-pro', 'cron-job'];
  
  const promises = devices.map((id, index) => {
    return journal.appendInput({
      id: `msg-${index}`,
      clientId: id,
      type: 'user',
      text: `Hello from ${id}`
    });
  });

  const results = await Promise.all(promises);
  console.log(`✅ Appended ${results.length} inputs.`);

  // 3. Metadata check
  await journal.updateMetadata({ status: 'busy', projectPath: '/tmp/test-project' });
  const meta = await journal.getMetadata();
  console.log('✅ Metadata updated:', meta?.status === 'busy' ? 'SUCCESS' : 'FAILED');

  // 4. Output append
  await journal.appendOutput(JSON.stringify({ type: 'thought', text: 'I am thinking...' }));
  await journal.appendOutput(JSON.stringify({ type: 'text', text: 'Hello user!' }));
  
  const history = await journal.readOutputHistory();
  console.log(`✅ Read ${history.length} lines of history.`);

  // 5. Mark processed
  await journal.markInputProcessed('msg-0');
  console.log('✅ Marked msg-0 as processed.');

  console.log('--- Layer 1 Test Complete ---');
}

test().catch(console.error);
