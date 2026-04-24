<script lang="ts">
  // No script needed — static content only
</script>

<svelte:head>
  <title>Manual · Mail</title>
</svelte:head>

<div class="h-full overflow-y-auto p-4 sm:p-6 lg:p-10">
  <div class="mx-auto max-w-2xl space-y-12">
    <div>
      <h1 class="text-xl font-semibold text-white">Manual</h1>
      <p class="mt-1 text-sm text-zinc-400">Keyboard shortcuts and feature guide.</p>
    </div>

    <!-- Keyboard shortcuts -->
    <section class="space-y-6">
      <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
        Keyboard shortcuts
      </h2>

      <div class="space-y-6">
        <!-- Navigation -->
        <div>
          <h3 class="mb-3 text-xs font-medium text-zinc-400">Navigation</h3>
          <div class="overflow-hidden rounded-xl border border-white/8">
            {#each [{ keys: ['←', '→'], desc: 'Switch focus between mailbox sidebar, mail list, and back' }, { keys: ['↑', '↓'], desc: 'Move selection up / down in the focused panel' }, { keys: ['j', 'k'], desc: 'Move selection down / up in the mail list' }, { keys: ['Enter'], desc: 'Open focused message' }, { keys: ['u', 'Esc'], desc: 'Go back to mail list from a message' }] as row, rowIndex (rowIndex)}
              <div
                class="flex flex-col items-start gap-3 border-b border-white/6 px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div class="flex shrink-0 gap-1.5">
                  {#each row.keys as k, keyIndex (keyIndex)}
                    <kbd
                      class="rounded-md border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-xs text-zinc-300"
                      >{k}</kbd
                    >
                  {/each}
                </div>
                <span class="text-sm text-zinc-400">{row.desc}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Mail list actions -->
        <div>
          <h3 class="mb-3 text-xs font-medium text-zinc-400">Mail list</h3>
          <div class="overflow-hidden rounded-xl border border-white/8">
            {#each [{ keys: ['x'], desc: 'Toggle selection on the focused message' }, { keys: ['* a'], desc: 'Select all visible messages' }, { keys: ['* n'], desc: 'Clear selection' }, { keys: ['e'], desc: 'Archive focused message (or all selected)' }, { keys: ['#'], desc: 'Move focused message to trash (or all selected)' }, { keys: ['c'], desc: 'Compose a new message' }, { keys: ['Esc'], desc: 'Clear selection' }] as row, rowIndex (rowIndex)}
              <div
                class="flex flex-col items-start gap-3 border-b border-white/6 px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div class="flex shrink-0 gap-1.5">
                  {#each row.keys as k, keyIndex (keyIndex)}
                    <kbd
                      class="rounded-md border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-xs text-zinc-300"
                      >{k}</kbd
                    >
                  {/each}
                </div>
                <span class="text-sm text-zinc-400">{row.desc}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Reading a message -->
        <div>
          <h3 class="mb-3 text-xs font-medium text-zinc-400">Reading a message</h3>
          <div class="overflow-hidden rounded-xl border border-white/8">
            {#each [{ keys: ['r'], desc: 'Reply' }, { keys: ['a'], desc: 'Reply all' }, { keys: ['f'], desc: 'Forward' }, { keys: ['e'], desc: 'Archive' }, { keys: ['#'], desc: 'Move to trash' }, { keys: ['u'], desc: 'Back to list' }] as row, rowIndex (rowIndex)}
              <div
                class="flex flex-col items-start gap-3 border-b border-white/6 px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div class="flex shrink-0 gap-1.5">
                  {#each row.keys as k, keyIndex (keyIndex)}
                    <kbd
                      class="rounded-md border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-xs text-zinc-300"
                      >{k}</kbd
                    >
                  {/each}
                </div>
                <span class="text-sm text-zinc-400">{row.desc}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Composer -->
        <div>
          <h3 class="mb-3 text-xs font-medium text-zinc-400">Composer</h3>
          <div class="overflow-hidden rounded-xl border border-white/8">
            {#each [{ keys: ['Esc'], desc: 'Minimise composer (draft is auto-saved)' }] as row, rowIndex (rowIndex)}
              <div
                class="flex flex-col items-start gap-3 border-b border-white/6 px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div class="flex shrink-0 gap-1.5">
                  {#each row.keys as k, keyIndex (keyIndex)}
                    <kbd
                      class="rounded-md border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-xs text-zinc-300"
                      >{k}</kbd
                    >
                  {/each}
                </div>
                <span class="text-sm text-zinc-400">{row.desc}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Mouse / pointer -->
        <div>
          <h3 class="mb-3 text-xs font-medium text-zinc-400">Mouse</h3>
          <div class="overflow-hidden rounded-xl border border-white/8">
            {#each [{ keys: ['Click checkbox'], desc: 'Select a message' }, { keys: ['Shift + click checkbox'], desc: 'Select a range of messages' }] as row, rowIndex (rowIndex)}
              <div
                class="flex flex-col items-start gap-3 border-b border-white/6 px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div class="flex shrink-0 gap-1.5">
                  {#each row.keys as k, keyIndex (keyIndex)}
                    <kbd
                      class="rounded-md border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-xs text-zinc-300"
                      >{k}</kbd
                    >
                  {/each}
                </div>
                <span class="text-sm text-zinc-400">{row.desc}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </section>

    <div class="border-t border-white/8"></div>

    <!-- Features -->
    <section class="space-y-6">
      <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Features</h2>

      <div class="space-y-5">
        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Bulk actions</h3>
          <p class="text-sm leading-6 text-zinc-400">
            Hover over a message row to reveal its checkbox. Check one to enter selection mode — a
            toolbar appears at the top of the list with Archive, Trash, Spam, and Mark read buttons.
            Hold <kbd
              class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >Shift</kbd
            > while clicking a second checkbox to select a range.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Drafts</h3>
          <p class="text-sm leading-6 text-zinc-400">
            The composer auto-saves your draft every 30 seconds and when you close it. Saved drafts
            appear below the Compose button in the sidebar — click one to resume editing. Drafts are
            deleted automatically when a message is sent.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Attachments</h3>
          <p class="text-sm leading-6 text-zinc-400">
            Attachments are stored locally during sync. Open a message to see its attachments
            displayed as thumbnail cards below the email body. Click any image, PDF, or video to
            open a full-screen preview. Use the arrow buttons or <kbd
              class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >←</kbd
            >
            <kbd class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >→</kbd
            >
            to navigate between previewable files. Press
            <kbd class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >Esc</kbd
            > or click outside to close.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Contact autocomplete</h3>
          <p class="text-sm leading-6 text-zinc-400">
            The To, CC, and BCC fields in the composer suggest contacts from your synced mail
            history as you type. Press <kbd
              class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >↑</kbd
            >
            <kbd class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >↓</kbd
            >
            to navigate the list,
            <kbd class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >Enter</kbd
            >
            to confirm,
            <kbd class="rounded border border-white/15 bg-white/6 px-1.5 py-0.5 font-mono text-xs"
              >Esc</kbd
            > to dismiss. Confirmed addresses appear as removable pills.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Signature</h3>
          <p class="text-sm leading-6 text-zinc-400">
            Set a signature in Settings → Signature. It is appended to every new message you
            compose. Plain text or HTML is accepted. Replies and forwarded messages do not include
            the signature automatically.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Filters</h3>
          <p class="text-sm leading-6 text-zinc-400">
            Filters auto-process incoming mail when it is first synced. Each rule matches a field
            (From, To, Subject, CC) against a value using one of four operators (contains, equals,
            starts with, ends with) and applies an action: mark as read, move to trash, or move to a
            specific folder. Rules are evaluated in order; the first match wins.
          </p>
          <p class="mt-2 text-sm leading-6 text-zinc-400">
            Configure filters in <strong class="font-medium text-zinc-300"
              >Settings → Filters</strong
            >.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Threaded view</h3>
          <p class="text-sm leading-6 text-zinc-400">
            Click the <span class="font-mono text-zinc-300">⊞</span> icon in the mail list toolbar to
            toggle threaded view. In threaded mode, related messages are grouped by conversation and shown
            as a single row with a count badge. Click a thread to open the accordion view where each message
            can be expanded individually.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Push notifications</h3>
          <p class="text-sm leading-6 text-zinc-400">
            To receive browser push notifications for new mail, go to <strong
              class="font-medium text-zinc-300">Settings → Push Notifications</strong
            >
            and click <em>Generate VAPID keys</em>. After reloading, your browser will prompt you
            for notification permission. Notifications are sent for each newly synced message.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Unread badge</h3>
          <p class="text-sm leading-6 text-zinc-400">
            The browser tab favicon and title show the number of unread messages in your inbox. The
            count refreshes every 30 seconds automatically.
          </p>
        </div>

        <div class="rounded-xl border border-white/8 p-4">
          <h3 class="mb-1 text-sm font-medium text-white">Sharing</h3>
          <p class="text-sm leading-6 text-zinc-400">
            Click the share icon in an open message to generate a public link. The link is copied to
            your clipboard and the message becomes readable by anyone with the URL, without
            requiring login.
          </p>
        </div>
      </div>
    </section>
  </div>
</div>
