import { SessionEngine } from './SessionEngine.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

async function runEmpiricalTest() {
  const engine = new SessionEngine();
  const sessionId = crypto.randomUUID();
  const projectPath = '/Users/maxwraae/projects/aiMessage-V3';
  const projectSlug = projectPath.replace(/\//g, "-");
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  
  // 1. Manually create a 'Vault' entry
  const projectDir = path.join(claudeProjectsDir, projectSlug);
  await fs.mkdir(projectDir, { recursive: true });
  const vaultPath = path.join(projectDir, `${sessionId}.jsonl`);
  
  const initialTurn = JSON.stringify({
    type: 'assistant',
    message: { 
      role: 'assistant', 
      content: [{ type: 'text', text: 'INITIAL MESSAGE' }] 
    },
    isSidechain: false,
    uuid: crypto.randomUUID()
  }) + '\n';
  
  await fs.writeFile(vaultPath, initialTurn);

  console.log(`🧪 Testing with fresh Session: ${sessionId}`);

  try {
    console.log('\n--- Phase 1: Initial Hydration ---');
    await engine.create(sessionId, projectPath, 'sonnet');
    
    // Trigger hydration via observe
    await engine.observe(sessionId, 0);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const journalPath = path.join(os.homedir(), '.aimessage', 'sessions', sessionId, 'out.jsonl');
    
    // Check hydration
    const content = await fs.readFile(journalPath, 'utf-8');
    console.log(`[Test] Journal content length: ${content.length}`);
    if (content.includes('INITIAL MESSAGE')) {
      console.log('✅ Journal hydrated correctly from Vault entry.');
    } else {
      console.log('❌ Initial hydration failed.');
    }

    console.log('\n--- Phase 2: Live Terminal Witness ---');
    const secretKey = 'EXTERNAL-MESSAGE-' + crypto.randomBytes(4).toString('hex');
    
    const fakeTurn = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: secretKey }] },
      isSidechain: false,
      uuid: crypto.randomUUID()
    }) + '\n';
    
    console.log(`Simulating terminal typing (Secret: ${secretKey})...`);
    await fs.appendFile(vaultPath, fakeTurn);
    
    console.log('Waiting for Engine to witness change (5s interval)...');
    await new Promise(resolve => setTimeout(resolve, 7000));
    
    const updatedContent = await fs.readFile(journalPath, 'utf-8');
    if (updatedContent.includes(secretKey)) {
      console.log('✅ SUCCESS: Engine witnessed and imported the external terminal message!');
    } else {
      console.log('❌ FAILURE: Engine missed the external change.');
    }

  } catch (err) {
    console.error('💥 Test Error:', err);
  } finally {
    engine.stop();
    // Cleanup fake vault entry
    await fs.unlink(vaultPath).catch(() => {});
    process.exit(0);
  }
}

runEmpiricalTest();
