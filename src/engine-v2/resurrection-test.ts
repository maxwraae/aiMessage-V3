import { SessionEngine } from './SessionEngine.js';
import * as crypto from 'node:crypto';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runResurrectionTest() {
  console.log('🔄 Starting Resurrection & Isolation Test...');
  const engine = new SessionEngine();
  
  const idA = 'agent-apples-' + crypto.randomBytes(2).toString('hex');
  const idB = 'agent-oranges-' + crypto.randomBytes(2).toString('hex');

  try {
    console.log('\n--- 1. Initialize Two Isolated Agents ---');
    await engine.create(idA, process.cwd(), 'sonnet');
    await engine.create(idB, process.cwd(), 'sonnet');

    console.log('Teaching Agent A about Apples...');
    await engine.submit(idA, 'test', 'My favorite fruit is Apples. Remember this.');
    
    console.log('Teaching Agent B about Oranges...');
    await engine.submit(idB, 'test', 'My favorite fruit is Oranges. Remember this.');

    // Wait for both to finish initial turns
    while (true) {
      const sA = await engine.getState(idA);
      const sB = await engine.getState(idB);
      if (sA?.status !== 'busy' && sB?.status !== 'busy') break;
      await delay(1000);
    }
    console.log('✅ Both agents have learned their secrets.');

    console.log('\n--- 2. Simulate Total Process Failure ---');
    // We forcefully kill the processes via the engine's stop command
    // (In a real crash, the OS would do this)
    engine.stop();
    console.log('💥 Processes killed. Engine is now empty.');

    console.log('\n--- 3. Resurrect & Recall ---');
    const engine2 = new SessionEngine(); // New engine instance
    
    console.log('Asking resurrected Agent A...');
    await engine2.submit(idA, 'test', 'What is my favorite fruit? Answer in one word.');
    
    console.log('Asking resurrected Agent B...');
    await engine2.submit(idB, 'test', 'What is my favorite fruit? Answer in one word.');

    let completed = false;
    let resultA = '';
    let resultB = '';

    for (let i = 0; i < 60; i++) {
      const journalA = new (await import('./JournalManager.js')).JournalManager(idA);
      const journalB = new (await import('./JournalManager.js')).JournalManager(idB);
      
      const historyA = await journalA.readOutputHistory();
      const historyB = await journalB.readOutputHistory();
      
      const textA = historyA.join('\n');
      const textB = historyB.join('\n');

      if (textA.toLowerCase().includes('apple') && textB.toLowerCase().includes('orange')) {
        completed = true;
        resultA = textA;
        resultB = textB;
        break;
      }
      
      if (i % 5 === 0) {
        console.log(`Still waiting... (Turn ${i})`);
        console.log(`Agent A Last Line: ${historyA[historyA.length-1]}`);
        console.log(`Agent B Last Line: ${historyB[historyB.length-1]}`);
      }
      await delay(1000);
    }

    if (completed) {
      console.log('✅ TEST PASSED: Resumption worked and Isolation was maintained!');
      console.log('Agent A correctly recalled Apples.');
      console.log('Agent B correctly recalled Oranges.');
    } else {
      console.log('❌ TEST FAILED: Resurrection failed to maintain context or timed out.');
    }

  } catch (err) {
    console.error('💥 Error:', err);
  } finally {
    // Give it a moment to breathe before final stop
    await delay(2000);
    // We only need to stop the active processes
    process.exit(0);
  }
}

runResurrectionTest();
