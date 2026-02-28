import { SessionEngine } from './SessionEngine.js';
const engine = new SessionEngine();
console.log('Active Sessions in Engine instance:', engine.listActiveSessions());
