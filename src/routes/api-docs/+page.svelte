<script lang="ts">
  import { resolve } from '$app/paths'

  const origin = $derived(typeof window === 'undefined' ? '' : window.location.origin)
  const base = $derived(`${origin}/api/external/v1`)
  const curlExample = $derived(`curl -H "Authorization: Bearer $MAIL_API_KEY" \\
  "${base}/messages?mailbox=inbox&unread=1&limit=25"

curl -X POST -H "Authorization: Bearer $MAIL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"user@example.com","subject":"Hello","html":"<p>Hello</p>"}' \\
  "${base}/messages"`)
  const initializeExample = JSON.stringify(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'client', version: '1.0.0' }
      }
    },
    null,
    2
  )
  const websocketExample = $derived(`const socket = new WebSocket(
  '${origin.replace(/^http/, 'ws')}/api/external/v1/mcp/ws',
  ['mcp', apiKey]
)`)
</script>

<svelte:head>
  <title>API documentation</title>
</svelte:head>

<div class="h-full overflow-y-auto bg-[#0d0d10] px-4 py-8 sm:px-6 lg:px-10">
  <main class="mx-auto max-w-5xl space-y-8">
    <header class="border-b border-white/8 pb-7">
      <p class="font-mono text-xs tracking-[0.2em] text-blue-300 uppercase">External integration</p>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Mail API & MCP
      </h1>
      <p class="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
        Read received mail, schedule outgoing messages, and expose the same operations as MCP tools.
        Create a key in <a href={resolve('settings/api')} class="text-blue-300 hover:text-blue-200"
          >Settings → API Keys</a
        >. Send it as a Bearer token. API keys have full read and send access.
      </p>
    </header>

    <section class="grid gap-4 md:grid-cols-3">
      <div class="rounded-2xl border border-white/8 bg-white/3 p-5">
        <p class="font-mono text-xs text-zinc-500">REST base</p>
        <code class="mt-2 block text-sm break-all text-zinc-200">{base}</code>
      </div>
      <div class="rounded-2xl border border-white/8 bg-white/3 p-5">
        <p class="font-mono text-xs text-zinc-500">MCP HTTP</p>
        <code class="mt-2 block text-sm break-all text-zinc-200">{base}/mcp</code>
      </div>
      <div class="rounded-2xl border border-white/8 bg-white/3 p-5">
        <p class="font-mono text-xs text-zinc-500">MCP WebSocket</p>
        <code class="mt-2 block text-sm break-all text-zinc-200"
          >{origin.replace(/^http/, 'ws')}/api/external/v1/mcp/ws</code
        >
      </div>
    </section>

    <details open class="group rounded-2xl border border-white/8 bg-white/3">
      <summary class="cursor-pointer list-none px-5 py-4 font-medium text-white">
        Authentication
      </summary>
      <div class="border-t border-white/8 p-5">
        <pre
          class="overflow-x-auto rounded-xl bg-black/30 p-4 text-xs leading-6 text-zinc-300"><code
            >Authorization: Bearer pmail_your_api_key</code
          ></pre>
        <p class="mt-3 text-sm text-zinc-500">
          The plaintext key is shown once. Store it as a secret and revoke it from settings when it
          is no longer needed.
        </p>
      </div>
    </details>

    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-white">REST endpoints</h2>
      <div class="overflow-hidden rounded-2xl border border-white/8 bg-white/3">
        {#each [['GET', '/mailboxes', 'List selectable mailboxes and slugs.'], ['GET', '/messages', 'List received messages. Supports mailbox, q, unread, limit, offset.'], ['GET', '/messages/:id', 'Get message body and attachment metadata.'], ['POST', '/messages', 'Schedule an outgoing message. Returns HTTP 202 and an operation ID.'], ['GET', '/send-jobs/:id', 'Read send operation status.'], ['GET', '/attachments/:id', 'Download a message attachment.']] as endpoint (`${endpoint[0]} ${endpoint[1]}`)}
          <div
            class="grid gap-2 border-b border-white/8 p-4 last:border-0 sm:grid-cols-[5rem_15rem_1fr]"
          >
            <span class="font-mono text-xs font-semibold text-blue-300">{endpoint[0]}</span>
            <code class="text-xs text-zinc-200">{endpoint[1]}</code>
            <span class="text-sm text-zinc-500">{endpoint[2]}</span>
          </div>
        {/each}
      </div>
      <pre
        class="overflow-x-auto rounded-2xl border border-white/8 bg-black/30 p-5 text-xs leading-6 text-zinc-300"><code
          >{curlExample}</code
        ></pre>
    </section>

    <section class="space-y-4">
      <h2 class="text-xl font-semibold text-white">MCP tools</h2>
      <div class="grid gap-4 md:grid-cols-3">
        {#each [['list_messages', 'List or search received messages.'], ['get_message', 'Read one message and attachment metadata.'], ['send_message', 'Schedule a new outgoing message.']] as tool (tool[0])}
          <div class="rounded-2xl border border-white/8 bg-white/3 p-5">
            <code class="text-sm text-blue-300">{tool[0]}</code>
            <p class="mt-2 text-sm text-zinc-500">{tool[1]}</p>
          </div>
        {/each}
      </div>
    </section>

    <details open class="rounded-2xl border border-white/8 bg-white/3">
      <summary class="cursor-pointer list-none px-5 py-4 font-medium text-white">
        HTTP and SSE transports
      </summary>
      <div class="space-y-4 border-t border-white/8 p-5 text-sm text-zinc-400">
        <p>
          Send MCP JSON-RPC requests with POST <code class="text-zinc-200">{base}/mcp</code>. For
          legacy HTTP+SSE clients, open <code class="text-zinc-200">{base}/mcp/sse</code>; the first
          endpoint event provides the authenticated message POST URL.
        </p>
        <pre
          class="overflow-x-auto rounded-xl bg-black/30 p-4 text-xs leading-6 text-zinc-300"><code
            >{initializeExample}</code
          ></pre>
      </div>
    </details>

    <details class="rounded-2xl border border-white/8 bg-white/3">
      <summary class="cursor-pointer list-none px-5 py-4 font-medium text-white">
        WebSocket transport
      </summary>
      <div class="space-y-3 border-t border-white/8 p-5 text-sm text-zinc-400">
        <p>
          Connect to <code class="text-zinc-200">/api/external/v1/mcp/ws</code> on the existing web
          port. Use subprotocols <code class="text-zinc-200">mcp</code> and the API key, then exchange
          MCP JSON-RPC text messages. WebSocket is provided as an application extension; standard MCP
          clients should prefer HTTP or SSE.
        </p>
        <pre
          class="overflow-x-auto rounded-xl bg-black/30 p-4 text-xs leading-6 text-zinc-300"><code
            >{websocketExample}</code
          ></pre>
      </div>
    </details>
  </main>
</div>
