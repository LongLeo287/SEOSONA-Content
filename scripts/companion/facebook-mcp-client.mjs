import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function parseFlowEnvelope(response) {
  if (response && response.structuredContent) return response.structuredContent;
  const text = response && Array.isArray(response.content)
    ? response.content.find((item) => item.type === 'text' && item.text)
    : null;
  if (!text) throw new Error('Flow MCP returned no structured result.');
  try { return JSON.parse(text.text); } catch { throw new Error('Flow MCP returned malformed JSON.'); }
}

export class FlowMcpClient {
  constructor({ command, args = [], env = process.env }) {
    if (!command) throw new Error('SEOSONA_FLOW_MCP_COMMAND is required.');
    this.command = command;
    this.args = args;
    this.env = env;
    this.client = null;
    this.transport = null;
  }

  async connect() {
    if (this.client) return;
    this.transport = new StdioClientTransport({ command: this.command, args: this.args, env: this.env, stderr: 'pipe' });
    this.client = new Client({ name: 'seosona-content-companion', version: '1.0.0' }, { capabilities: {} });
    await this.client.connect(this.transport);
  }

  async callTool(name, args) {
    await this.connect();
    return parseFlowEnvelope(await this.client.callTool({ name, arguments: args }));
  }

  async close() {
    if (this.client) await this.client.close();
    this.client = null;
    this.transport = null;
  }
}

export function createFlowMcpClientFromEnv(env = process.env) {
  const command = env.SEOSONA_FLOW_MCP_COMMAND;
  const serverPath = env.SEOSONA_FLOW_MCP_SERVER;
  if (!command || !serverPath) throw new Error('Set SEOSONA_FLOW_MCP_COMMAND and SEOSONA_FLOW_MCP_SERVER before starting the Content Companion.');
  if (!env.SEOSONA_LOCAL_MCP_TOKEN) throw new Error('SEOSONA_LOCAL_MCP_TOKEN is required for the Flow MCP bridge.');
  return new FlowMcpClient({ command, args: [serverPath], env });
}
