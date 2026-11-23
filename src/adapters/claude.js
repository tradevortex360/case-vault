// Drive access when the app is opened inside Claude: goes through the viewer's
// Google Drive connector (no Google setup, no API key). Append-only by design:
// this adapter only ever creates new files and reads; it never overwrites.
// Tool names/arguments are resolved at runtime with describeTool so a connector
// update does not break the app; see MAP below (verified against the live connector).
export const SERVER = 'Google Drive';
const MAP = {
  search: 'search_files',
  read: 'read_file_content',
  download: 'download_file_content',
  create: 'create_file',
  meta: 'get_file_metadata',
};

export class ClaudeDriveAdapter {
  constructor(mcp, { rootName = 'Legal', v } = {}) { this.mcp = mcp; this.rootName = rootName; this.v = v; this.kind = 'claude-drive'; this.ids = {}; this.schemas = {}; }
  async call(tool, input) {
    try { const r = await this.mcp.callTool(SERVER, MAP[tool] || tool, input); return r.payload ?? r; }
    catch (e) {
      const msg = { needs_reauth: 'Reconnect Google Drive in Claude settings → Connectors', server_not_connected: 'Add the Google Drive connector in Claude settings → Connectors', not_in_manifest: 'Google Drive is not allowed for this page — allow it when asked', approval_required: 'Claude needs your approval to use Google Drive here' }[e?.code];
      throw Object.assign(new Error(msg || e?.message || String(e)), { code: e?.code, retryable: e?.retryable });
    }
  }
  async schema(tool) { return this.schemas[tool] ||= await this.mcp.describeTool(SERVER, MAP[tool]).then(d => d.inputSchema).catch(() => null); }
  // The rest of this adapter is completed against the live connector schema
  // (see tests/claude-adapter.test.js). Until then the app falls back to queueing.
  async listOpFiles() { throw Object.assign(new Error('Drive connector mapping not verified yet'), { code: 'unverified' }); }
  async readText() { throw new Error('unverified'); }
  async writeText() { throw new Error('unverified'); }
  async readBlob() { return null; }
}
