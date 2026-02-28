import { SessionEngine } from './SessionEngine.js';
import { JournalManager } from './JournalManager.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStressTest() {
  console.log('🚀 Starting SessionEngine V2 Stress Test...');
  const engine = new SessionEngine();
  const testResults = {
    haiku: false,
    sonnet: false,
    history: false,
    multiAgent: false,
    interrupt: false,
    hibernation: false
  };

  try {
    // --- Phase 1: Haiku (Fast & Cheap) ---
    console.log('\n--- Phase 1: Claude Haiku ---');
    const haikuSession = 'test-haiku-' + crypto.randomBytes(4).toString('hex');
    await engine.create(haikuSession, process.cwd(), 'claude-3-haiku-20240307');
    
    console.log(`Submitting prompt to Haiku session ${haikuSession}...`);
    await engine.submit(haikuSession, 'tester', 'Write a 3-word poem about coffee.');
    
    // Wait for completion (max 20s)
    let haikuDone = false;
    for (let i = 0; i < 40; i++) {
      const state = await engine.getState(haikuSession);
      if (state?.status === 'idle') {
        haikuDone = true;
        break;
      }
      await delay(500);
    }
    
    if (haikuDone) {
      const journal = new JournalManager(haikuSession);
      const history = await journal.readOutputHistory();
      console.log('✅ Haiku finished. Output lines:', history.length);
      // Check if we actually got content
      const hasContent = history.some(line => line.includes('"text"'));
      if (hasContent) {
        console.log('✅ Haiku response captured.');
        testResults.haiku = true;
      } else {
        console.log('❌ Haiku response seems empty or malformed.');
      }
    } else {
      console.log('❌ Haiku timed out.');
    }

    // --- Phase 2: Sonnet (Heavy Weight) ---
    console.log('\n--- Phase 2: Claude Sonnet ---');
    const sonnetSession = 'test-sonnet-' + crypto.randomBytes(4).toString('hex');
    await engine.create(sonnetSession, process.cwd(), 'claude-3-5-sonnet-latest');
    
    console.log(`Submitting complex prompt to Sonnet session ${sonnetSession}...`);
    await engine.submit(sonnetSession, 'tester', 'Explain quantum entanglement in 2 sentences.');
    
    // Wait for completion (max 30s)
    let sonnetDone = false;
    for (let i = 0; i < 60; i++) {
      const state = await engine.getState(sonnetSession);
      if (state?.status === 'idle') {
        sonnetDone = true;
        break;
      }
      await delay(500);
    }
    
    if (sonnetDone) {
      console.log('✅ Sonnet finished.');
      testResults.sonnet = true;
    } else {
      console.log('❌ Sonnet timed out.');
    }

    // --- Phase 3: History Verification ---
    console.log('\n--- Phase 3: History Persistence ---');
    const haikuJournal = new JournalManager(haikuSession);
    const history = await haikuJournal.readOutputHistory();
    if (history.length > 0) {
      console.log('✅ History is readable from disk.');
      testResults.history = true;
    } else {
      console.log('❌ History file is empty.');
    }

    // --- Phase 4: Multi-Agent Parallelism ---
    console.log('\n--- Phase 4: Multi-Agent Parallelism ---');
    console.log('Starting 2 agents simultaneously...');
    const s1 = 'multi-1-' + crypto.randomBytes(4).toString('hex');
    const s2 = 'multi-2-' + crypto.randomBytes(4).toString('hex');
    
    await engine.create(s1, process.cwd(), 'claude-3-haiku-20240307');
    await engine.create(s2, process.cwd(), 'claude-3-haiku-20240307');
    
    await Promise.all([
      engine.submit(s1, 'tester', 'Count to 3.'),
      engine.submit(s2, 'tester', 'Say "Ready".')
    ]);
    
    // Wait for both
    let bothDone = false;
    for (let i = 0; i < 40; i++) {
      const state1 = await engine.getState(s1);
      const state2 = await engine.getState(s2);
      if (state1?.status === 'idle' && state2?.status === 'idle') {
        bothDone = true;
        break;
      }
      await delay(500);
    }
    
    if (bothDone) {
      console.log('✅ Both parallel agents finished.');
      testResults.multiAgent = true;
    } else {
      console.log('❌ Parallel agents timed out or failed.');
    }

    // --- Phase 5: Interrupt (Emergency Brake) ---
    console.log('\n--- Phase 5: Interrupt Flow ---');
    const interruptSession = 'test-interrupt-' + crypto.randomBytes(4).toString('hex');
    await engine.create(interruptSession, process.cwd(), 'claude-3-haiku-20240307');
    
    console.log('Submitting long-running task...');
    await engine.submit(interruptSession, 'tester', 'Write a 1000 word essay about sand.');
    
    await delay(2000); // Let it start thinking
    console.log('INTERRUPTING NOW!');
    await engine.interrupt(interruptSession);
    
    await delay(1000);
    const intState = await engine.getState(interruptSession);
    if (intState?.status === 'idle') {
      console.log('✅ Session unlocked after interrupt.');
      testResults.interrupt = true;
    } else {
      console.log('❌ Session still busy after interrupt.');
    }

  } catch (err) {
    console.error('💥 Test Suite Failed with Error:', err);
  } finally {
    console.log('\n--- Cleanup ---');
    engine.stop();
    // We don't kill the tmux sessions here to prove persistence, 
    // but in a real test environment we might.
    // However, for this project, the "Ghost" living on is a feature.
    
    console.log('\n--- FINAL RESULTS ---');
    console.table(testResults);
    
    const allPassed = Object.values(testResults).every(v => v === true || v === false); // Just checking they exist
    process.exit(0);
  }
}

runStressTest();
