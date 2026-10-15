// 最小の MCP クライアント（Streamable HTTP）。おつかい MCP の道具を一覧して呼ぶだけ。
// 返事が JSON でも SSE（data: 行）でも読めるようにする。

const PROTOCOL = "2025-11-25";

function parseBody(text, contentType) {
  if (!contentType?.includes("text/event-stream")) return JSON.parse(text);
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  return JSON.parse(data[data.length - 1]);
}

// doFetch: 同じ Cloudflare アカウントの Worker を呼ぶときは Service Binding の fetch を渡す（普通の URL では呼べない）。
export function mcpClient(url, token, doFetch = fetch) {
  let session = null;
  let nextId = 1;
  const call = async (method, params, notify = false) => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": PROTOCOL,
      "user-agent": "tanuki-alexa-bridge/0.1",
    };
    if (session) headers["mcp-session-id"] = session;
    // Service Binding 経由だと Host が付かず、MCP の DNS リバインディング対策に「Missing Host header」で断られる。
    if (doFetch !== fetch) headers.host = new URL(url).host;
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: nextId++, method, params };
    const res = await doFetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    session = res.headers.get("mcp-session-id") ?? session;
    if (notify) return null;
    if (!res.ok) throw new Error(`MCP ${method} ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const msg = parseBody(await res.text(), res.headers.get("content-type"));
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  };
  return {
    async connect() {
      await call("initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "tanuki-alexa-bridge", version: "0.1.0" },
      });
      await call("notifications/initialized", {}, true);
    },
    listTools: async () => (await call("tools/list", {})).tools,
    callTool: (name, args) => call("tools/call", { name, arguments: args }),
  };
}
