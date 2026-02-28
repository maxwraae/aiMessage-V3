import { MuxManager } from './MuxManager.js';
import * as crypto from 'node:crypto';

async function test() {
  const sessionId = 'test-mux-' + crypto.randomBytes(4).toString('hex');
  const mux = new MuxManager();

  console.log(`--- Testing Layer 2: MuxManager for ${sessionId} ---`);

  // 1. Create session
  console.log('Creating tmux session...');
  await mux.createSession(sessionId, process.cwd(), 'echo "Hello from tmux"; sleep 100');
  
  const exists = await mux.sessionExists(sessionId);
  console.log('✅ Session exists:', exists ? 'SUCCESS' : 'FAILED');

  const pid = await mux.getPanePid(sessionId);
  console.log('✅ Found Pane PID:', pid);

  // 2. List sessions
  const sessions = await mux.listActiveSessions();
  console.log('✅ Active sessions list includes our ID:', sessions.includes(sessionId) ? 'SUCCESS' : 'FAILED');

  // 3. Send keys (Simulate input)
  console.log('Sending keys...');
  await mux.sendKeys(sessionId, 'ls -la');
  console.log('✅ Keys sent.');

  // 4. Kill session
  console.log('Killing session...');
  await mux.killSession(sessionId);
  const stillExists = await mux.sessionExists(sessionId);
  console.log('✅ Session killed:', !stillExists ? 'SUCCESS' : 'FAILED');

  console.log('--- Layer 2 Test Complete ---');
}

test().catch(console.error);
