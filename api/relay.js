// Vercel Serverless Function for E2EE Relay by NRP (Retrieve & Wipe)
const globalQueue = globalThis.slkQueue || (globalThis.slkQueue = []);

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Cleanup expired packets (> 5 minutes)
  const now = Date.now();
  while (globalQueue.length > 0 && now - globalQueue[0].timestamp > 5 * 60 * 1000) {
    globalQueue.shift();
  }

  if (req.method === 'POST') {
    const packet = req.body || {};
    if (!packet.targetNrp || !packet.senderNrp) {
      return res.status(400).json({ error: 'Missing targetNrp or senderNrp' });
    }
    
    // Add timestamp if not present
    if (!packet.timestamp) packet.timestamp = Date.now();
    if (!packet.id && packet.msgId) packet.id = packet.msgId;

    globalQueue.push(packet);
    if (globalQueue.length > 200) {
      globalQueue.shift();
    }
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const nrp = String(req.query.nrp || '').trim().toUpperCase();
    if (!nrp) {
      return res.status(400).json({ error: 'Missing nrp query param' });
    }

    const matchedMessages = [];
    const remainingQueue = [];

    for (const p of globalQueue) {
      const target = String(p.targetNrp || '').trim().toUpperCase();
      if (target === nrp || target === 'ALL') {
        matchedMessages.push(p);
      } else {
        remainingQueue.push(p);
      }
    }

    // Replace queue with remaining unread packets (Wipe retrieved)
    globalThis.slkQueue = remainingQueue;

    return res.json({ messages: matchedMessages });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
