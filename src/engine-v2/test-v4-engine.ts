/**
 * V4 Engine Test Suite
 *
 * Sequential test runner that proves the tmux engine works end-to-end
 * by simulating what the browser does: HTTP requests and WebSocket
 * connections against localhost:7777.
 *
 * Prerequisites:
 *   - Server must be running: npm run dev (or npm start)
 *   - Claude CLI must be available at ~/.local/bin/claude
 *
 * Run with:
 *   npx tsx src/engine-v2/test-v4-engine.ts
 */

import WebSocket from 'ws';
import * as http from 'node:http';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:7777';
const WS_BASE = 'ws://localhost:7777';

// ── Shared state across scenarios ────────────────────────

const sharedState: {
  scenario1SessionId?: string;
  allSessionIds: string[];
} = {
  allSessionIds: [],
};

// ── Helpers ──────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes an HTTP request and returns parsed JSON response.
 */
async function httpJson(
  method: string,
  path: string,
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * WebSocket test client. Connects to a session and collects messages.
 */
class TestSocket {
  private ws: WebSocket;
  private messages: any[] = [];
  private waiters: Array<{
    predicate: (msg: any) => boolean;
    resolve: (msg: any) => void;
    reject: (err: Error) => void;
  }> = [];
  private openPromise: Promise<void>;
  private closed = false;

  constructor(sessionId: string) {
    this.ws = new WebSocket(`${WS_BASE}/ws/chat/${sessionId}`);

    this.openPromise = new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });

    this.ws.on('message', (raw) => {
      // Server sends newline-delimited JSON, possibly multiple lines per message
      const lines = raw.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          this.messages.push(msg);

          // Check waiters
          for (let i = this.waiters.length - 1; i >= 0; i--) {
            if (this.waiters[i].predicate(msg)) {
              this.waiters[i].resolve(msg);
              this.waiters.splice(i, 1);
            }
          }
        } catch {
          // Ignore unparseable lines
        }
      }
    });

    this.ws.on('close', () => {
      this.closed = true;
      // Reject any remaining waiters
      for (const w of this.waiters) {
        w.reject(new Error('WebSocket closed while waiting'));
      }
      this.waiters = [];
    });
  }

  async ready(): Promise<void> {
    await this.openPromise;
  }

  /**
   * Wait for a message matching the predicate. Checks already-collected
   * messages first, then waits for new ones.
   */
  async waitFor(
    predicate: (msg: any) => boolean,
    timeoutMs = 60000
  ): Promise<any> {
    // Check existing messages first
    const existing = this.messages.find(predicate);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(
          new Error(
            `waitFor timed out after ${timeoutMs}ms. Collected ${this.messages.length} messages: ${JSON.stringify(this.messages.map((m) => m.type + (m.status ? ':' + m.status : '') + (m.item?.kind ? ':' + m.item.kind : '')))}`
          )
        );
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /**
   * Collect all messages for a duration.
   */
  async collectFor(ms: number): Promise<any[]> {
    await delay(ms);
    return [...this.messages];
  }

  /**
   * Wait until we've collected messages satisfying ALL predicates, or timeout.
   */
  async waitForAll(
    predicates: Array<(msg: any) => boolean>,
    timeoutMs = 90000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const allSatisfied = predicates.every((p) => this.messages.some(p));
      if (allSatisfied) return;
      await delay(500);
    }

    const missing = predicates
      .map((p, i) => (this.messages.some(p) ? null : `predicate[${i}]`))
      .filter(Boolean);
    throw new Error(
      `waitForAll timed out. Missing: ${missing.join(', ')}. Collected ${this.messages.length} messages.`
    );
  }

  send(msg: any): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    if (!this.closed) {
      this.ws.close();
      this.closed = true;
    }
  }

  get all(): any[] {
    return [...this.messages];
  }
}

/**
 * Create a test project directory.
 */
function createTestProject(name: string): string {
  const dir = `/tmp/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a session via the API.
 */
async function createSession(
  projectPath: string,
  model = 'haiku'
): Promise<string> {
  const { status, data } = await httpJson('POST', '/api/agents', {
    projectPath,
    model,
  });
  if (status !== 201) {
    throw new Error(`Failed to create session: ${status} ${JSON.stringify(data)}`);
  }
  const id = data.id;
  sharedState.allSessionIds.push(id);
  return id;
}

/**
 * Destroy a session via the test API.
 */
async function destroySession(id: string): Promise<void> {
  await httpJson('POST', `/api/test/destroy-session/${id}`);
}

/**
 * Restart the engine via the test API.
 */
async function restartEngine(): Promise<void> {
  const { status, data } = await httpJson('POST', '/api/test/restart-engine');
  if (status !== 200 || !data?.success) {
    throw new Error(`Engine restart failed: ${status} ${JSON.stringify(data)}`);
  }
}

/**
 * Cleanup all test artifacts.
 */
async function cleanupAll(): Promise<void> {
  console.log('\n--- Cleanup ---');

  // Destroy all tracked sessions
  for (const id of sharedState.allSessionIds) {
    try {
      await destroySession(id);
      console.log(`  Destroyed session ${id}`);
    } catch {
      // May already be destroyed
    }
  }

  // Kill any remaining test tmux sessions
  try {
    const sessions = execSync('tmux list-sessions 2>/dev/null', {
      encoding: 'utf-8',
    });
    const testSessions = sessions
      .split('\n')
      .filter((l) => l.includes('aim-session'))
      .map((l) => l.split(':')[0]);
    for (const s of testSessions) {
      // Only kill sessions we created (tracked in allSessionIds)
      const sessionId = s.replace('aim-session-', '');
      if (sharedState.allSessionIds.includes(sessionId)) {
        try {
          execSync(`tmux kill-session -t "${s}" 2>/dev/null`);
          console.log(`  Killed tmux session ${s}`);
        } catch {
          // Already dead
        }
      }
    }
  } catch {
    // No tmux sessions
  }

  // Remove test project dirs
  try {
    const tmpDirs = execSync('ls -d /tmp/test-v4-project-* 2>/dev/null', {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`  Removed ${dir}`);
    }
  } catch {
    // No test dirs
  }
}

// ── Message predicates ───────────────────────────────────

function isAgentStatus(status: string) {
  return (msg: any) => msg.type === 'agent_status' && msg.status === status;
}

function isHistorySnapshot() {
  return (msg: any) => msg.type === 'history_snapshot';
}

function isStreamItemKind(kind: string) {
  return (msg: any) => msg.type === 'stream_item' && msg.item?.kind === kind;
}

function isAssistantContaining(text: string) {
  const lower = text.toLowerCase();
  return (msg: any) =>
    msg.type === 'stream_item' &&
    msg.item?.kind === 'assistant_message' &&
    msg.item.text.toLowerCase().includes(lower);
}

function isUserContaining(text: string) {
  const lower = text.toLowerCase();
  return (msg: any) =>
    msg.type === 'stream_item' &&
    msg.item?.kind === 'user_message' &&
    msg.item.text.toLowerCase().includes(lower);
}

function hasHistoryContaining(text: string) {
  const lower = text.toLowerCase();
  return (msg: any) =>
    msg.type === 'history_snapshot' &&
    Array.isArray(msg.items) &&
    msg.items.some(
      (item: any) =>
        typeof item.text === 'string' && item.text.toLowerCase().includes(lower)
    );
}

// ── Scenarios ────────────────────────────────────────────

type ScenarioResult = { pass: boolean; reason: string };

/**
 * Scenario 1: Create session and chat (haiku)
 */
async function scenario1_createAndChat(): Promise<ScenarioResult> {
  const projectPath = createTestProject('test-v4-project-1');

  // Create session
  const sessionId = await createSession(projectPath, 'haiku');
  sharedState.scenario1SessionId = sessionId;
  console.log(`  Created session: ${sessionId}`);

  // Connect WebSocket
  const sock = new TestSocket(sessionId);
  await sock.ready();

  // Wait for initial status and history
  await sock.waitFor(isAgentStatus('idle'), 30000);
  const snapshot = await sock.waitFor(isHistorySnapshot(), 10000);
  console.log(`  Got history snapshot with ${snapshot.items.length} items`);

  // Send message
  sock.send({ type: 'user_input', text: 'reply with only the word PING' });
  console.log('  Sent: "reply with only the word PING"');

  // Wait for thinking status
  await sock.waitFor(isAgentStatus('thinking'), 30000);
  console.log('  Agent is thinking...');

  // Wait for user_message echo
  await sock.waitFor(isUserContaining('PING'), 10000);
  console.log('  Got user_message echo');

  // Wait for assistant response containing PING
  await sock.waitFor(isAssistantContaining('PING'), 60000);
  console.log('  Got assistant_message containing PING');

  // Wait for idle status
  await sock.waitFor(isAgentStatus('idle'), 30000);
  console.log('  Agent returned to idle');

  sock.close();
  return { pass: true, reason: 'Got PING response, status cycled thinking -> idle' };
}

/**
 * Scenario 2: Reconnect and see history
 */
async function scenario2_reconnectHistory(): Promise<ScenarioResult> {
  const sessionId = sharedState.scenario1SessionId;
  if (!sessionId) {
    return { pass: false, reason: 'No session ID from Scenario 1' };
  }

  // Open new WebSocket to same session
  const sock = new TestSocket(sessionId);
  await sock.ready();

  // Wait for history snapshot that contains previous conversation
  const snapshot = await sock.waitFor(
    (msg: any) =>
      msg.type === 'history_snapshot' &&
      Array.isArray(msg.items) &&
      msg.items.length > 0,
    30000
  );

  // Verify history contains PING messages
  const hasUserPing = snapshot.items.some(
    (item: any) =>
      item.kind === 'user_message' &&
      item.text.toLowerCase().includes('ping')
  );
  const hasAssistantPing = snapshot.items.some(
    (item: any) =>
      item.kind === 'assistant_message' &&
      item.text.toLowerCase().includes('ping')
  );
  console.log(
    `  History: ${snapshot.items.length} items, hasUserPing=${hasUserPing}, hasAssistantPing=${hasAssistantPing}`
  );

  if (!hasUserPing || !hasAssistantPing) {
    sock.close();
    return {
      pass: false,
      reason: `History missing PING messages. hasUserPing=${hasUserPing}, hasAssistantPing=${hasAssistantPing}`,
    };
  }

  // Send new message
  sock.send({ type: 'user_input', text: 'reply with only the word PONG' });
  console.log('  Sent: "reply with only the word PONG"');

  // Wait for assistant response containing PONG
  await sock.waitFor(isAssistantContaining('PONG'), 60000);
  console.log('  Got assistant_message containing PONG');

  sock.close();
  return {
    pass: true,
    reason: 'History snapshot has previous messages, new message works',
  };
}

/**
 * Scenario 3: Queue two messages
 */
async function scenario3_queueMessages(): Promise<ScenarioResult> {
  const projectPath = createTestProject('test-v4-project-1');
  const sessionId = await createSession(projectPath, 'haiku');
  console.log(`  Created session: ${sessionId}`);

  const sock = new TestSocket(sessionId);
  await sock.ready();

  // Wait for initial state
  await sock.waitFor(isHistorySnapshot(), 15000);
  await sock.waitFor(isAgentStatus('idle'), 30000);

  // Send both messages without waiting
  sock.send({ type: 'user_input', text: 'reply with only the word ALPHA' });
  sock.send({ type: 'user_input', text: 'reply with only the word BETA' });
  console.log('  Sent ALPHA and BETA back to back');

  // Wait for both assistant responses
  await sock.waitForAll(
    [isAssistantContaining('ALPHA'), isAssistantContaining('BETA')],
    120000
  );
  console.log('  Got both ALPHA and BETA responses');

  // Verify ordering: ALPHA before BETA
  const allMsgs = sock.all;
  const alphaIdx = allMsgs.findIndex(isAssistantContaining('ALPHA'));
  const betaIdx = allMsgs.findIndex(isAssistantContaining('BETA'));

  if (alphaIdx >= betaIdx) {
    sock.close();
    await destroySession(sessionId);
    return {
      pass: false,
      reason: `ALPHA (idx=${alphaIdx}) not before BETA (idx=${betaIdx})`,
    };
  }

  sock.close();
  await destroySession(sessionId);
  return {
    pass: true,
    reason: `Both responses received, ALPHA (idx=${alphaIdx}) before BETA (idx=${betaIdx})`,
  };
}

/**
 * Scenario 4: Two sessions simultaneously
 */
async function scenario4_twoSessions(): Promise<ScenarioResult> {
  const path2 = createTestProject('test-v4-project-2');
  const path3 = createTestProject('test-v4-project-3');

  const session1 = await createSession(path2, 'haiku');
  const session2 = await createSession(path3, 'haiku');
  console.log(`  Created session1: ${session1}`);
  console.log(`  Created session2: ${session2}`);

  const sock1 = new TestSocket(session1);
  const sock2 = new TestSocket(session2);
  await sock1.ready();
  await sock2.ready();

  // Wait for both to be ready
  await sock1.waitFor(isHistorySnapshot(), 15000);
  await sock2.waitFor(isHistorySnapshot(), 15000);
  await sock1.waitFor(isAgentStatus('idle'), 30000);
  await sock2.waitFor(isAgentStatus('idle'), 30000);

  // Send to both
  sock1.send({ type: 'user_input', text: 'reply with only the word FIRST' });
  sock2.send({ type: 'user_input', text: 'reply with only the word SECOND' });
  console.log('  Sent FIRST to session1, SECOND to session2');

  // Wait for responses
  await sock1.waitFor(isAssistantContaining('FIRST'), 60000);
  await sock2.waitFor(isAssistantContaining('SECOND'), 60000);
  console.log('  Both sessions responded correctly');

  // Check for cross-contamination
  const sock1HasSecond = sock1.all.some(isAssistantContaining('SECOND'));
  const sock2HasFirst = sock2.all.some(isAssistantContaining('FIRST'));

  sock1.close();
  sock2.close();
  await destroySession(session1);
  await destroySession(session2);

  if (sock1HasSecond || sock2HasFirst) {
    return {
      pass: false,
      reason: `Cross-contamination! sock1HasSecond=${sock1HasSecond}, sock2HasFirst=${sock2HasFirst}`,
    };
  }

  return { pass: true, reason: 'No cross-contamination between sessions' };
}

/**
 * Scenario 5: Persistence across engine restart
 */
async function scenario5_engineRestart(): Promise<ScenarioResult> {
  const projectPath = createTestProject('test-v4-project-5');
  const sessionId = await createSession(projectPath, 'haiku');
  console.log(`  Created session: ${sessionId}`);

  // Chat and get response
  const sock1 = new TestSocket(sessionId);
  await sock1.ready();
  await sock1.waitFor(isHistorySnapshot(), 15000);
  await sock1.waitFor(isAgentStatus('idle'), 30000);

  sock1.send({ type: 'user_input', text: 'reply with only the word BEFORE' });
  console.log('  Sent: "reply with only the word BEFORE"');

  await sock1.waitFor(isAssistantContaining('BEFORE'), 60000);
  console.log('  Got BEFORE response');
  sock1.close();

  // Restart engine
  console.log('  Restarting engine...');
  await restartEngine();
  console.log('  Engine restarted');

  // Verify tmux session still alive
  const tmuxSessionName = `aim-session-${sessionId}`;
  try {
    execSync(`tmux has-session -t "${tmuxSessionName}" 2>/dev/null`);
    console.log(`  tmux session ${tmuxSessionName} is alive`);
  } catch {
    return {
      pass: false,
      reason: `tmux session ${tmuxSessionName} died after engine restart`,
    };
  }

  // Allow time for reconciliation
  await delay(2000);

  // Reconnect and verify history
  const sock2 = new TestSocket(sessionId);
  await sock2.ready();

  const snapshot = await sock2.waitFor(
    (msg: any) =>
      msg.type === 'history_snapshot' && Array.isArray(msg.items),
    30000
  );

  const hasBefore = snapshot.items.some(
    (item: any) =>
      item.kind === 'assistant_message' &&
      item.text.toLowerCase().includes('before')
  );
  console.log(
    `  History after restart: ${snapshot.items.length} items, hasBefore=${hasBefore}`
  );

  if (!hasBefore) {
    sock2.close();
    await destroySession(sessionId);
    return { pass: false, reason: 'History lost after engine restart' };
  }

  // Send new message
  sock2.send({ type: 'user_input', text: 'reply with only the word AFTER' });
  console.log('  Sent: "reply with only the word AFTER"');

  await sock2.waitFor(isAssistantContaining('AFTER'), 60000);
  console.log('  Got AFTER response');

  sock2.close();
  await destroySession(sessionId);
  return {
    pass: true,
    reason: 'History intact after restart, new messages work',
  };
}

/**
 * Scenario 6: Two clients, same session
 */
async function scenario6_twoClients(): Promise<ScenarioResult> {
  const projectPath = createTestProject('test-v4-project-6');
  const sessionId = await createSession(projectPath, 'haiku');
  console.log(`  Created session: ${sessionId}`);

  // Connect client A
  const sockA = new TestSocket(sessionId);
  await sockA.ready();
  await sockA.waitFor(isHistorySnapshot(), 15000);
  await sockA.waitFor(isAgentStatus('idle'), 30000);

  // Connect client B
  const sockB = new TestSocket(sessionId);
  await sockB.ready();
  await sockB.waitFor(isHistorySnapshot(), 15000);

  // Send from A
  sockA.send({ type: 'user_input', text: 'reply with only the word SHARED' });
  console.log('  Client A sent: "reply with only the word SHARED"');

  // Both should receive the user_message and assistant_message
  await sockA.waitFor(isAssistantContaining('SHARED'), 60000);
  console.log('  Client A got SHARED response');

  // Give B a moment to receive the streamed messages
  await delay(3000);

  const bHasUserMsg = sockB.all.some(isUserContaining('SHARED'));
  const bHasAssistantMsg = sockB.all.some(isAssistantContaining('SHARED'));
  console.log(
    `  Client B: hasUserMsg=${bHasUserMsg}, hasAssistantMsg=${bHasAssistantMsg}`
  );

  sockA.close();
  sockB.close();
  await destroySession(sessionId);

  if (!bHasAssistantMsg) {
    return {
      pass: false,
      reason: `Client B did not receive assistant message. hasUserMsg=${bHasUserMsg}, hasAssistantMsg=${bHasAssistantMsg}`,
    };
  }

  return { pass: true, reason: 'Both clients received the same messages' };
}

/**
 * Scenario 7: Interrupt mid-response
 */
async function scenario7_interrupt(): Promise<ScenarioResult> {
  const projectPath = createTestProject('test-v4-project-7');
  const sessionId = await createSession(projectPath, 'haiku');
  console.log(`  Created session: ${sessionId}`);

  const sock = new TestSocket(sessionId);
  await sock.ready();
  await sock.waitFor(isHistorySnapshot(), 15000);
  await sock.waitFor(isAgentStatus('idle'), 30000);

  // Send a long prompt
  sock.send({
    type: 'user_input',
    text: 'write a very long essay about the history of mathematics, at least 2000 words',
  });
  console.log('  Sent long essay prompt');

  // Wait for thinking status
  await sock.waitFor(isAgentStatus('thinking'), 30000);
  console.log('  Agent is thinking...');

  // Give it a couple seconds to start generating
  await delay(3000);

  // Interrupt
  console.log('  Sending interrupt (DELETE /api/agents/:id)...');
  await httpJson('DELETE', `/api/agents/${sessionId}`);

  // Wait for idle status (within 15s)
  try {
    await sock.waitFor(isAgentStatus('idle'), 15000);
    console.log('  Agent returned to idle after interrupt');
  } catch {
    // The status might already be idle if the interrupt resolved quickly
    const lastStatus = sock.all
      .filter((m: any) => m.type === 'agent_status')
      .pop();
    if (lastStatus?.status !== 'idle') {
      sock.close();
      await destroySession(sessionId);
      return {
        pass: false,
        reason: `Agent did not return to idle after interrupt. Last status: ${lastStatus?.status}`,
      };
    }
    console.log('  Agent was already idle');
  }

  // Send follow-up message
  sock.send({
    type: 'user_input',
    text: 'reply with only the word RECOVERED',
  });
  console.log('  Sent: "reply with only the word RECOVERED"');

  await sock.waitFor(isAssistantContaining('RECOVERED'), 60000);
  console.log('  Got RECOVERED response');

  sock.close();
  await destroySession(sessionId);
  return {
    pass: true,
    reason: 'Status returned to idle after interrupt, next message works',
  };
}

/**
 * Scenario 8: Project path verification (CLAUDE.md)
 */
async function scenario8_projectPath(): Promise<ScenarioResult> {
  const projectPath = createTestProject('test-v4-project-verify');

  // Write CLAUDE.md with a secret phrase
  fs.writeFileSync(
    `${projectPath}/CLAUDE.md`,
    'The secret test phrase is TOPAZ-SEVEN.'
  );
  console.log(`  Created CLAUDE.md in ${projectPath}`);

  const sessionId = await createSession(projectPath, 'haiku');
  console.log(`  Created session: ${sessionId}`);

  const sock = new TestSocket(sessionId);
  await sock.ready();
  await sock.waitFor(isHistorySnapshot(), 15000);
  await sock.waitFor(isAgentStatus('idle'), 30000);

  sock.send({
    type: 'user_input',
    text: 'What is the secret test phrase in CLAUDE.md? Reply with only the phrase.',
  });
  console.log('  Sent: "What is the secret test phrase?"');

  await sock.waitFor(isAssistantContaining('TOPAZ-SEVEN'), 60000);
  console.log('  Got assistant_message containing TOPAZ-SEVEN');

  sock.close();
  await destroySession(sessionId);

  // Cleanup the test project dir
  fs.rmSync(projectPath, { recursive: true, force: true });

  return { pass: true, reason: 'Claude read the CLAUDE.md with correct project path' };
}

// ── Test Runner ──────────────────────────────────────────

const scenarios: Array<[string, () => Promise<ScenarioResult>]> = [
  ['1. Create session and chat (haiku)', scenario1_createAndChat],
  ['2. Reconnect and see history', scenario2_reconnectHistory],
  ['3. Queue two messages', scenario3_queueMessages],
  ['4. Two sessions simultaneously', scenario4_twoSessions],
  ['5. Persistence across engine restart', scenario5_engineRestart],
  ['6. Two clients, same session', scenario6_twoClients],
  ['7. Interrupt mid-response', scenario7_interrupt],
  ['8. Project path verification', scenario8_projectPath],
];

async function main() {
  console.log('=== V4 Engine Test Suite ===\n');

  // Verify server is running
  try {
    const { status } = await httpJson('GET', '/api/agents');
    if (status !== 200) {
      console.error(
        'Server not responding correctly. Make sure the server is running on localhost:7777.'
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(
      'Cannot connect to server. Make sure the server is running on localhost:7777.'
    );
    console.error(`  Error: ${err}`);
    process.exit(1);
  }

  console.log('Server is reachable. Starting tests...\n');

  const results: { name: string; pass: boolean; reason: string }[] = [];

  // Run scenarios sequentially
  for (const [name, fn] of scenarios) {
    console.log(`\n--- ${name} ---`);
    try {
      const result = await fn();
      results.push({ name, ...result });
      console.log(
        result.pass ? `  PASS: ${result.reason}` : `  FAIL: ${result.reason}`
      );
    } catch (err) {
      const reason = `EXCEPTION: ${err instanceof Error ? err.message : String(err)}`;
      results.push({ name, pass: false, reason });
      console.log(`  FAIL: ${reason}`);
    }
  }

  // Cleanup runs regardless of results
  try {
    await cleanupAll();
  } catch (err) {
    console.error(`Cleanup error: ${err}`);
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed ===`);
  results.forEach((r) =>
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.name}: ${r.reason}`)
  );

  process.exit(passed === results.length ? 0 : 1);
}

main();
