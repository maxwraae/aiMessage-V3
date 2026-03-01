# Interaction Feel

How the conversation should feel from the user's perspective. Scene by scene.

This is the design companion to `message-lifecycle.md`. That doc traces data through the system. This one traces the human experience.

---

## Design Principles

**Temperature, not labels.** The interface communicates through warmth, motion, and stillness. Never through text labels like "Agent is thinking..." or status badges.

**The top bar and sidebar row are the same element at two zoom levels.** Whatever the sidebar avatar does, the panel header does. One design language, two distances. The sidebar is peripheral (glancing across sessions). The header is focal (inside one conversation).

**Every signal earns its place.** No animation without purpose. No glow without meaning. If something moves, it should be the only thing moving. Stillness is the default. Motion is the exception.

**The `result` frame is the natural message boundary.** One result = one complete turn = one "message" in the iMessage sense. Unread count tracks result frames since last viewed. The preview line pulls from the last `assistant_message` text block before the result frame.

---

## Scene 1: At Rest

The conversation is quiet. Your last exchange sits there. The top bar is just a bar. Neutral. The input field has soft placeholder text. The whole panel feels like a page in a book you've set down. Nothing is asking for your attention. Nothing is moving. Calm.

**Top bar:** Neutral. Title, model badge, nothing else. No color, no glow.
**Sidebar row:** Normal weight title, preview line showing last agent words, timestamp. Calm.
**Input field:** Soft placeholder text. Ready but not eager.
**Conversation area:** Still. A page you've set down.

The whole panel has the quality of something complete. Not empty, not waiting. Just done.

---

## Scene 2: You Send

Your blue bubble slides up and settles. Beneath it, nothing. A breath. Half a second of nothing. This matters. The pause is human. It says "I heard you."

Then, where the response will be, nothing appears in the conversation. But the top bar wakes up. A thin line along its bottom edge begins to glow. Not a bar with a destination. Not dots. A single horizontal warmth, like a pen touching paper before the first word. It doesn't move left to right. It breathes. Slightly brighter, slightly softer. Brighter, softer. It's not measuring progress. It's communicating presence. Someone is here, gathering their thoughts.

No percentage. No animation that implies "almost done." Because you don't know. And the design shouldn't lie.

**Top bar:** Warm glow along bottom edge. Breathes on a slow cycle, roughly 3 seconds in, 3 seconds out. Communicates presence, not progress.

**Sidebar row:** The avatar's status indicator picks up the same breathing rhythm. Same warmth. One language, two places.

**Conversation area:** Still. No dots, no spinner, no "thinking" label. The breathing top bar is the only signal that something is happening. The conversation itself waits quietly.

**What's NOT here:** No bouncing dots. No "Typing..." text. No progress percentage. No animated skeleton. The thinking state is ambient, not focal. You notice it peripherally, not by staring at it.

**Duration:** This state can last 2 seconds or 30 seconds. The breathing rhythm doesn't imply speed or progress. It says "connected, present, working." That's all.

---

## Scene 3: First Words

The glow doesn't disappear. It dissolves upward into text. The transition is a cross-dissolve, not a cut.

The words don't slam in one character at a time like a typewriter. They don't appear all at once like a page load. They arrive in phrases. Buffered. Three, four, five words at a time. Like watching someone's handwriting appear on paper across the table. You see the thought form, not the mechanism. The rhythm is slightly irregular, the way real speech is. A short phrase. Then a longer one. Then a pause. Then three words.

This is the key decision. **Don't stream raw tokens. Buffer them and release in natural clusters.** The extra 200 milliseconds of delay is invisible. The smoothness is everything. Jittery character-by-character streaming screams "I am a machine." Phrased text says "I am thinking and speaking."

**Top bar:** The breathing glow dims gradually over about 2 seconds as text begins flowing. The conversation is taking over from the signal. It doesn't disappear the instant the first token arrives. It eases out. By the time a full sentence is visible, the header is settled again.

**Sidebar row:** Preview line updates to the streaming text. The breathing indicator fades. The row shows the conversation is active through the updating preview, not through a status dot.

---

## Scene 4: Mid-Response

The text grows downward. The view scrolls gently to follow, but not aggressively. If you scroll up to re-read something, the view respects that. It doesn't yank you back down on every new phrase. A small subtle indicator at the bottom, maybe a soft downward chevron breathing, says "there's more below when you're ready."

**Tool calls:** Appear inline, collapsed, understated. A small line showing the tool name and status. Not visually loud. Expandable if you're curious, invisible if you're not.

**Top bar:** Neutral. Settled. The conversation itself is the activity. You don't need the header to tell you something is happening when you can see it happening.

---

## Scene 5: Done

The last phrase lands. No fanfare. No "done" indicator. The breathing glow is simply gone because there's text where it was. The conversation just... is. The way a message thread looks after someone finishes talking. Quiet. Present. Complete.

**Input field:** Ready. That's the only cue you need. The conversation went from moving to still, and the stillness is the signal.

**Top bar:** Neutral. Same as at rest.

**Sidebar row:** Preview line shows the agent's final words. If you're looking at this panel, nothing changes in the sidebar because you've already "read" it.

---

## Scene 6: You Walked Away

You're in a different panel, or a different app. The agent finishes while you're not watching.

**Top bar of that panel:** A subtle shift in presence. The title text goes slightly bolder, or the bar carries a barely-there warm tint. Something that, when your eye sweeps across four panels, makes one of them feel warmer than the others. "Something arrived here."

**Sidebar row:** Bold title. Preview line updated to the agent's last words. Blue dot appears to the left of the avatar. Standard iMessage unread. No ring, no pulse. Just "there's something here when you're ready."

**When you open it:** Everything settles. Title goes back to normal weight. Blue dot disappears. The bar returns to neutral. Read state. Back to Scene 1.

---

## Multi-Panel: Four Conversations

Close your eyes. You're looking at a 2x2 grid. You sent messages to the top two.

Top left: the breathing glow. Thinking. Top right: text flowing in, phrase by phrase. Active. Bottom two: quiet. Last messages sitting there from earlier. Muted, not dim. Just settled.

Your eye goes to the motion. Top right, where text is appearing. That's natural. You don't need to be told where to look. Movement draws the eye. The breathing glow in top left is subtle enough that it sits in your periphery. You know it's there. You're not watching it.

When top left starts producing text, that movement catches your peripheral vision. You glance over. Two streams now. Your eye bounces between them naturally, the way you'd listen to two people talking at a dinner table.

The bottom panels recede. Not hidden. Just quiet. The way an empty chair at the table is still there but not demanding anything.

If one of the bottom panels received a response while you were focused on the top two, its header has that subtle warmth. Your eye will catch it when it sweeps. No urgency.

**The principle underneath all of this:** the interface should feel like it has a pulse, not a loading state. Alive, not busy.

---

## The Three Agent Intents

From the agent's perspective, there are three deliberate acts:

| Intent | What it is | How you experience it |
|--------|-----------|----------------------|
| **Working** | Producing output (tool calls, file reads, thinking) | Nothing changes on the sidebar or header. You can peek if curious. The stream is there. |
| **Talking** | The agent composed something for you. The final `assistant_message` before a `result` frame. | Preview line updates. Title bolds. Blue dot appears (if you're not looking). This IS the conversation. |
| **Calling** | The agent needs your attention now. A deliberate notification. | The ring. A pulse on the avatar. A push that crosses the boundary from "check when you want" to "look now." Rare by design. Requires a separate protocol (notification skill). |

**95% of interactions are "Talking."** The result frame is already the turn boundary. The frontend tracks "result frames since last viewed" per session. No new protocol needed.

**"Calling" is the 5%.** This requires a new signal: the agent deliberately emitting a notification frame. This can wait until the 95% feels right.

---

## What's Explicitly Not Here

- Progress bars or filling indicators
- Bouncing dots or typing indicators
- "Agent is thinking..." text labels
- Color-coded status badges
- Toast notifications inside the conversation
- Percentages or time estimates
- Skeleton loading screens
- "Done" announcements

Every signal is ambient. Temperature, not text. Motion, not labels. The interface communicates through presence and stillness, not through announcements.

---

## Signal Vocabulary (Summary)

| Moment | Top Bar | Sidebar Row | Conversation |
|--------|---------|-------------|--------------|
| At rest | Neutral | Normal weight, preview, timestamp | Still |
| Thinking | Bottom edge glows, breathing | Avatar indicator breathes | Nothing visible |
| First words | Glow cross-fades out (2s) | Preview updates | Text arrives in phrase clusters |
| Mid-response | Neutral | Preview updating | Text building, gentle scroll |
| Done | Neutral | Preview shows final words | Still. Input ready. |
| Unread (walked away) | Subtle warmth / bold title | Bold title, blue dot, preview | Unchanged until opened |
| Notification (rare) | Ring / pulse | Ring on avatar | Agent's message highlighted |
