/** list_threads does not load turn contents. Only genuinely active chats need
 * read_thread for approval flags; missing (older) rows get one bounded probe. */
export function createStatusReader(call, { now = Date.now, ttl = 10000 } = {}) {
  let rows = new Map(), expires = 0, fetching = null, failed = null;
  async function summaries() {
    if (fetching) return fetching;
    if (now() < expires) { if (failed) throw failed; return rows; }
    fetching = (async () => {
      try {
        const list = await call('list_threads', { limit: 50 });
        rows = new Map([...(list.pinnedThreads || []), ...(list.threads || [])]
          .filter(t => t.kind === 'codex' && t.hostId === 'local').map(t => [t.id, t]));
        failed = null; return rows;
      } catch (e) { failed = e; throw e; }
      finally { expires = now() + ttl; fetching = null; }
    })();
    return fetching;
  }
  return {
    summaries,
    async readStatus(id) {
      const row = (await summaries()).get(id);
      if (row && ['idle', 'notLoaded', 'systemError'].includes(row.status)) return { type: row.status };
      return (await call('read_thread', { threadId: id, hostId: 'local', turnLimit: 1,
        includeOutputs: false, maxOutputCharsPerItem: 0 })).thread.status;
    },
  };
}
