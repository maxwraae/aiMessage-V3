import WebSocket from 'ws';

async function testSocket() {
  const sessionId = 'pulsar-' + Math.random().toString(36).slice(2, 6);
  const ws = new WebSocket(`http://0.0.0.0:7777/ws/chat/${sessionId}`);

  console.log(`📡 Connecting to Session: ${sessionId}`);

  ws.on('open', () => {
    console.log('✅ Socket Connected.');
    console.log('📤 Sending "Hello"...');
    ws.send(JSON.stringify({ type: 'user_input', text: 'Say "Live!"' }));
  });

  let messageCount = 0;
  ws.on('message', (data) => {
    const frame = data.toString();
    if (frame.includes('Live!')) {
      console.log('✅ SUCCESS: Received response from Agent via WebSocket!');
      process.exit(0);
    }
    
    if (messageCount === 0) console.log('📥 Receiving live stream...');
    messageCount++;
    
    // Safety timeout
    if (messageCount > 100) {
      console.log('❌ Too many messages without match.');
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.log('❌ Timeout: No response from Agent.');
    process.exit(1);
  }, 15000);
}

testSocket();
