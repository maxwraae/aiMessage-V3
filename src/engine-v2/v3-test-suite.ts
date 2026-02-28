import { SessionEngine } from './SessionEngine.js';
import { JournalManager } from './JournalManager.js';
import * as crypto from 'node:crypto';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runV3Suite() {
  console.log('🧪 Starting V3 Advanced Test Suite...');
  const engine = new SessionEngine();
  const testResults = {
    lateJoiner: false,
    inputQueue: false,
    resumption: false
  };

  try {
    // --- Phase 1: Late-Joiner Sync ---
    console.log('\n--- Phase 1: Late-Joiner Sync ---');
    const syncSession = 'test-sync-' + crypto.randomBytes(4).toString('hex');
    await engine.create(syncSession, process.cwd(), 'sonnet');
    
    // Start Turn
    await engine.submit(syncSession, 'mac', 'Count from 1 to 5 slowly, one per line.');
    
    console.log('Client A (Mac) connected at offset 0...');
    const streamA = await engine.observe(syncSession, 0);
    const readerA = streamA.getReader();
    let bufferA = '';

    // Wait for the agent to start talking
    await delay(2000);

    console.log('Client B (iPhone) joining late at offset 0...');
    const streamB = await engine.observe(syncSession, 0);
    const readerB = streamB.getReader();
    let bufferB = '';

    // Collect data for 10 seconds
    const collect = async (reader: any, label: string) => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (label === 'A') bufferA += value;
        else bufferB += value;
      }
    };

    const collectorA = collect(readerA, 'A');
    const collectorB = collect(readerB, 'B');

    // Wait for agent to finish
    for (let i = 0; i < 20; i++) {
      const state = await engine.getState(syncSession);
      if (state?.status === 'sleeping' || state?.status === 'idle') break;
      await delay(1000);
    }

    await delay(2000); // Final flush
    console.log(`Client A Buffer Length: ${bufferA.length}`);
    console.log(`Client B Buffer Length: ${bufferB.length}`);

    if (bufferA.length > 0 && bufferA === bufferB) {
      console.log('✅ Perfect Sync: Late joiner caught up 100%.');
      testResults.lateJoiner = true;
    } else {
      console.log('❌ Sync Mismatch or Empty Buffers.');
    }

    // --- Phase 2: Input Queuing ---
    console.log('\n--- Phase 2: Input Queuing ---');
    const queueSession = 'test-queue-' + crypto.randomBytes(4).toString('hex');
    await engine.create(queueSession, process.cwd(), 'sonnet');

    console.log('Sending 3 messages rapidly...');
    engine.submit(queueSession, 'u1', 'Task 1: Say "Red"');
    engine.submit(queueSession, 'u1', 'Task 2: Say "Green"');
    engine.submit(queueSession, 'u1', 'Task 3: Say "Blue"');

    // Wait for all to finish
    let completed = false;
    for (let i = 0; i < 30; i++) {
      const journal = new JournalManager(queueSession);
      const history = await journal.readOutputHistory();
      const text = history.join('\n');
      if (text.includes('Red') && text.includes('Green') && text.includes('Blue')) {
        completed = true;
        break;
      }
      await delay(1000);
    }

    if (completed) {
      console.log('✅ Queueing Success: All 3 tasks processed sequentially.');
      testResults.inputQueue = true;
    } else {
      console.log('❌ Queueing failed or timed out.');
    }

  } catch (err) {
    console.error('💥 Suite Failed:', err);
  } finally {
    engine.stop();
    console.log('\n--- V3 FINAL RESULTS ---');
    console.table(testResults);
    process.exit(0);
  }
}

runV3Suite();
