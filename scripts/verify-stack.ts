import WebSocket from 'ws';

async function verify() {
  const baseUrl = 'http://127.0.0.1:7777';
  const wsBaseUrl = 'ws://127.0.0.1:7777';
  
  console.log("1. Checking server health (POST /api/agents)...");
  const res = await fetch(`${baseUrl}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath: process.cwd() })
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create agent: ${res.status} ${text}`);
  }
  
  const agent = await res.json() as { id: string };
  console.log(`   Agent created: ${agent.id}`);
  
  console.log(`2. Connecting to WebSocket (/ws/chat/${agent.id})...`);
  const ws = new WebSocket(`${wsBaseUrl}/ws/chat/${agent.id}`);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Verification timed out waiting for assistant response"));
    }, 15000);

    ws.on('open', () => {
      console.log("   WS connected. Sending 'hi'...");
      ws.send(JSON.stringify({ type: "user_input", text: "hi" }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "stream_item" && msg.item.kind === "assistant_message") {
        console.log(`   Received assistant response: "${msg.item.text}"`);
        console.log("\n✅ Stack verification SUCCESSFUL");
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

verify().catch(err => {
  console.error("\n❌ Stack verification FAILED");
  console.error(err);
  process.exit(1);
});
