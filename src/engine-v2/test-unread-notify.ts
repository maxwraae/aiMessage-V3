/**
 * test-unread-notify.ts
 *
 * Runtime test suite for the unread + notification system.
 * Exercises JournalManager directly and asserts correct behavior for:
 *   - hasUnread computation
 *   - ::notify regex parsing
 *   - Notification scanning in output history
 *
 * Run with: npx tsx src/engine-v2/test-unread-notify.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { JournalManager } from './JournalManager.js';

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const tempId = crypto.randomUUID();
  const tempSessionDir = path.join(os.homedir(), '.aimessage', 'sessions', tempId);
  const journal = new JournalManager(tempId);

  try {
    await journal.ensureStorage();

    // -----------------------------------------------------------------------
    // Test 1: hasUnread = true when result exists and never viewed
    // -----------------------------------------------------------------------
    section('Test 1: hasUnread — result exists, never viewed');

    await journal.updateMetadata({
      sessionId: tempId,
      projectPath: '/tmp/test',
      model: 'test',
      status: 'idle',
      lastSeen: new Date().toISOString(),
      lastResultAt: '2026-02-28T09:00:00Z',
      lastViewedAt: undefined,
    });

    const meta1 = await journal.getMetadata();
    const hasUnread1 = !!(meta1?.lastResultAt && (!meta1?.lastViewedAt || meta1.lastResultAt > meta1.lastViewedAt));
    assert(hasUnread1 === true, 'hasUnread is true when result exists and lastViewedAt is undefined');

    // -----------------------------------------------------------------------
    // Test 2: hasUnread = false when viewed after result
    // -----------------------------------------------------------------------
    section('Test 2: hasUnread — viewed after result');

    await journal.updateMetadata({ lastViewedAt: '2026-02-28T09:01:00Z' });

    const meta2 = await journal.getMetadata();
    const hasUnread2 = !!(meta2?.lastResultAt && (!meta2?.lastViewedAt || meta2.lastResultAt > meta2.lastViewedAt));
    assert(hasUnread2 === false, 'hasUnread is false when lastViewedAt is after lastResultAt');

    // -----------------------------------------------------------------------
    // Test 3: hasUnread = true when new result arrives after view
    // -----------------------------------------------------------------------
    section('Test 3: hasUnread — new result after view');

    await journal.updateMetadata({ lastResultAt: '2026-02-28T09:02:00Z' });

    const meta3 = await journal.getMetadata();
    const hasUnread3 = !!(meta3?.lastResultAt && (!meta3?.lastViewedAt || meta3.lastResultAt > meta3.lastViewedAt));
    assert(hasUnread3 === true, 'hasUnread is true when lastResultAt is after lastViewedAt');

    // -----------------------------------------------------------------------
    // Test 4: ::notify regex — subject extraction and text cleaning
    // -----------------------------------------------------------------------
    section('Test 4: ::notify regex parsing');

    {
      const text = "Here are the results.\n::notify Tests passing, 14/14\nLet me know if you need more.";
      const notifyRegex = /^::notify\s+(.+)$/gm;
      let notificationSubject: string | null = null;
      let match;
      while ((match = notifyRegex.exec(text)) !== null) {
        notificationSubject = match[1].trim();
      }
      const cleanText = text.replace(/^::notify\s+.+$/gm, '').trim();

      assert(notificationSubject === 'Tests passing, 14/14', '::notify subject extracted correctly');
      // The replace() removes the ::notify line's content but leaves the surrounding newline,
      // so the two remaining lines are separated by \n\n (the blank line where ::notify was).
      assert(cleanText === 'Here are the results.\n\nLet me know if you need more.', 'cleanText removes ::notify line (blank line left in place)');
      assert(!cleanText.includes('::notify'), 'cleanText does not contain ::notify');
    }

    // -----------------------------------------------------------------------
    // Test 5: ::notify as only content — fallback to subject
    // -----------------------------------------------------------------------
    section('Test 5: ::notify as only content');

    {
      const text = '::notify Research complete';
      const notifyRegex = /^::notify\s+(.+)$/gm;
      let notificationSubject: string | null = null;
      let match;
      while ((match = notifyRegex.exec(text)) !== null) {
        notificationSubject = match[1].trim();
      }
      const cleanText = text.replace(/^::notify\s+.+$/gm, '').trim();
      const visibleText = cleanText || notificationSubject || '';

      assert(notificationSubject === 'Research complete', '::notify subject extracted when only content');
      assert(cleanText === '', 'cleanText is empty string after stripping only ::notify line');
      assert(visibleText === 'Research complete', 'fallback visibleText uses notificationSubject');
    }

    // -----------------------------------------------------------------------
    // Test 6: Multiple ::notify lines — last wins
    // -----------------------------------------------------------------------
    section('Test 6: Multiple ::notify lines — last wins');

    {
      const text = '::notify First\nSome text\n::notify Second';
      const notifyRegex = /^::notify\s+(.+)$/gm;
      let notificationSubject: string | null = null;
      let match;
      while ((match = notifyRegex.exec(text)) !== null) {
        notificationSubject = match[1].trim();
      }

      assert(notificationSubject === 'Second', 'last ::notify subject wins when multiple present');
    }

    // -----------------------------------------------------------------------
    // Test 7: Notification scanning in output history — found
    // -----------------------------------------------------------------------
    section('Test 7: Notification scanning — found');

    const frames = [
      { type: 'stream_item', item: { kind: 'assistant_message', text: 'Hello', id: 'a1', timestamp: '2026-02-28T09:00:00Z' } },
      { type: 'stream_item', item: { kind: 'notification', subject: 'Task done', id: 'n1', timestamp: '2026-02-28T09:00:01Z' } },
      { type: 'stream_item', item: { kind: 'assistant_message', text: 'More text', id: 'a2', timestamp: '2026-02-28T09:00:02Z' } },
    ];

    for (const frame of frames) {
      await journal.appendOutput(JSON.stringify(frame));
    }

    const history7 = await journal.readOutputHistory();

    let latestNotification7: string | undefined;
    const viewedAt7 = '1970-01-01';
    for (let i = history7.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(history7[i]);
        if (frame.type === 'stream_item' && frame.item?.kind === 'notification') {
          if (frame.item.timestamp > viewedAt7) {
            latestNotification7 = frame.item.subject;
            break;
          }
        }
      } catch { continue; }
    }

    assert(latestNotification7 === 'Task done', 'notification found when viewedAt is before all frames');

    // -----------------------------------------------------------------------
    // Test 8: Notification scanning — not found when viewedAt is after frames
    // -----------------------------------------------------------------------
    section('Test 8: Notification scanning — not found when viewedAt is after notification');

    let latestNotification8: string | undefined;
    const viewedAt8 = '2026-02-28T09:01:00Z'; // after all frames
    for (let i = history7.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(history7[i]);
        if (frame.type === 'stream_item' && frame.item?.kind === 'notification') {
          if (frame.item.timestamp > viewedAt8) {
            latestNotification8 = frame.item.subject;
            break;
          }
        }
      } catch { continue; }
    }

    assert(latestNotification8 === undefined, 'no notification found when viewedAt is after all frame timestamps');

  } finally {
    // Cleanup temp session directory
    try {
      await fs.rm(tempSessionDir, { recursive: true, force: true });
      console.log(`\nCleanup: removed ${tempSessionDir}`);
    } catch (err) {
      console.log(`\nCleanup warning: could not remove ${tempSessionDir}:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
