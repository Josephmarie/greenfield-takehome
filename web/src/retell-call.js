export function spokenTranscript(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => (item.role === 'agent' || item.role === 'user') && typeof item.content === 'string')
    .map(item => ({ who: item.role, text: item.content }));
}

export function startRetellCall({ RetellClient, publicKey, agentId, onStatus, onEnd, onError, onTranscript }) {
  if (!publicKey || !agentId) throw new Error('Voice calling is not configured.');
  const client = new RetellClient({ key: publicKey });
  return client.createWebCall({
    agent_id: agentId,
    transcript: true,
    hooks: { onStatus, onEnd, onError, onTranscript: items => onTranscript?.(spokenTranscript(items)) },
  });
}
