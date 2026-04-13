<script lang="ts">
  import { onMount } from 'svelte'
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import Underline from '@tiptap/extension-underline'
  import Link from '@tiptap/extension-link'
  import TextAlign from '@tiptap/extension-text-align'
  import {
    X,
    Minus,
    Minimize2,
    Maximize2,
    Send,
    Bold,
    Italic,
    Underline as UnderlineIcon,
    Strikethrough,
    Link as LinkIcon,
    List,
    ListOrdered,
    Quote,
    Code,
    Code2,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    Undo2,
    Redo2,
    Heading1,
    Heading2,
    Heading3,
    Minus as HrIcon
  } from 'lucide-svelte'
  import { composer, closeComposer } from '$lib/composer.svelte'
  import AddressInput from '$lib/components/AddressInput.svelte'

  let editorEl = $state<HTMLElement | undefined>(undefined)
  let editor: Editor | null = null
  let sending = $state(false)
  let sendError = $state<string | null>(null)
  let showCc = $state(false)
  let showBcc = $state(false)
  let showLinkInput = $state(false)
  let linkInputValue = $state('')
  let editorTick = $state(0) // increments on editor transactions to force re-render
  let showDiscardDialog = $state(false)

  // Create the editor once when the element is first available
  $effect(() => {
    if (!editorEl || editor) return
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({ codeBlock: { languageClassPrefix: 'language-' } }),
        Underline,
        Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
        TextAlign.configure({ types: ['heading', 'paragraph'] })
      ],
      content: '<p></p>',
      editorProps: {
        attributes: {
          class: 'composer-editor focus:outline-none min-h-[180px] p-4'
        }
      },
      onTransaction: () => {
        editorTick += 1
      }
    })
  })

  // When composer opens, load fresh content and focus
  let prevOpen = false
  $effect(() => {
    if (composer.open && !prevOpen && editor) {
      editor.commands.setContent(composer.initialHtml || '<p></p>')
      editor.commands.focus('end')
      showCc = !!composer.cc
      showBcc = !!composer.bcc
    }
    prevOpen = composer.open
  })

  // Draft auto-save — every 30 seconds
  let saveDraftTimer: ReturnType<typeof setInterval> | null = null
  let lastSavedContent = ''

  async function saveDraft() {
    if (!composer.open || !editor) return
    const html = editor.getHTML()
    const key = `${composer.to}|${composer.cc}|${composer.bcc}|${composer.subject}|${html}`
    if (key === lastSavedContent) return // nothing changed
    lastSavedContent = key

    try {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: composer.draftId ?? undefined,
          to: composer.to,
          cc: composer.cc,
          bcc: composer.bcc,
          subject: composer.subject,
          html,
          inReplyTo: composer.inReplyTo
        })
      })
      if (res.ok) {
        const data = await res.json()
        composer.draftId = data.id
        composer.lastSavedAt = Date.now()
      }
    } catch {
      // silent — draft save failures shouldn't interrupt composition
    }
  }

  async function deleteDraft() {
    if (!composer.draftId) return
    try {
      await fetch(`/api/drafts/${composer.draftId}`, { method: 'DELETE' })
    } catch {
      // ignore
    }
    composer.draftId = null
  }

  onMount(() => {
    saveDraftTimer = setInterval(saveDraft, 30_000)

    const handleBeforeUnload = () => {
      if (!composer.open || !editor) return
      const html = editor.getHTML()
      const payload = JSON.stringify({
        id: composer.draftId ?? undefined,
        to: composer.to,
        cc: composer.cc,
        bcc: composer.bcc,
        subject: composer.subject,
        html,
        inReplyTo: composer.inReplyTo
      })
      navigator.sendBeacon('/api/drafts', new Blob([payload], { type: 'application/json' }))
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (saveDraftTimer) clearInterval(saveDraftTimer)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  })

  function isActive(name: string, attrs?: Record<string, unknown>) {
    if (editorTick < 0) return false
    return editor?.isActive(name, attrs) ?? false
  }

  function isAlignActive(align: string) {
    if (editorTick < 0) return false
    if (!editor) return false
    return (
      editor.isActive('paragraph', { textAlign: align }) ||
      editor.isActive('heading', { textAlign: align })
    )
  }

  function btnClass(active: boolean) {
    return [
      'flex items-center justify-center rounded p-1.5 transition',
      active ? 'bg-white/12 text-white' : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-200'
    ].join(' ')
  }

  function applyLink() {
    if (!editor) return
    const url = linkInputValue.trim()
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    }
    showLinkInput = false
    linkInputValue = ''
  }

  function openLinkInput() {
    const existing = editor?.getAttributes('link').href as string | undefined
    linkInputValue = existing ?? ''
    showLinkInput = true
  }

  async function send() {
    if (!editor || sending) return
    sendError = null
    const html = editor.getHTML()
    const payload = {
      to: composer.to,
      cc: composer.cc || null,
      bcc: composer.bcc || null,
      subject: composer.subject,
      html,
      inReplyTo: composer.inReplyTo
    }
    sending = true
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        await deleteDraft()
        closeComposer()
      } else {
        const text = await res.text()
        sendError = text || 'Failed to send message.'
      }
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'Failed to send message.'
    } finally {
      sending = false
    }
  }

  function discard() {
    // If there's content and no draft yet saved, ask; otherwise just close
    showDiscardDialog = true
  }

  async function discardAndDelete() {
    await deleteDraft()
    showDiscardDialog = false
    closeComposer()
  }

  async function saveDraftAndClose() {
    await saveDraft()
    showDiscardDialog = false
    closeComposer()
  }

  function toggleMinimized() {
    if (composer.minimized) {
      composer.minimized = false
      return
    }

    composer.fullscreen = false
    composer.minimized = true
  }

  function toggleFullscreen() {
    composer.minimized = false
    composer.fullscreen = !composer.fullscreen
  }

  function titleLabel() {
    if (composer.mode === 'reply' || composer.mode === 'reply-all') return 'Reply'
    if (composer.mode === 'forward') return 'Forward'
    return 'New Message'
  }
</script>

<div
  class={[
    'fixed z-50 flex flex-col overflow-hidden border border-white/10 bg-[#18181c] shadow-2xl',
    composer.fullscreen
      ? 'inset-0 rounded-none sm:inset-4 sm:rounded-xl'
      : 'right-4 bottom-0 rounded-t-xl'
  ]}
  style:width={composer.fullscreen ? null : '580px'}
  style:height={composer.fullscreen ? null : '520px'}
  style:max-height={composer.fullscreen ? null : '90vh'}
  style:display={composer.open ? 'flex' : 'none'}
>
  <!-- Title bar -->
  <div class="flex shrink-0 items-center justify-between bg-[#1e1e24] px-4 py-3 select-none">
    <span class="text-sm font-medium text-zinc-200">{titleLabel()}</span>
    <div class="flex items-center gap-1">
      <button
        type="button"
        aria-label={composer.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onclick={toggleFullscreen}
        class="rounded p-1 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
      >
        {#if composer.fullscreen}
          <Minimize2 size={14} />
        {:else}
          <Maximize2 size={14} />
        {/if}
      </button>
      <button
        type="button"
        aria-label="Minimize"
        onclick={toggleMinimized}
        class="rounded p-1 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200"
      >
        {#if composer.minimized}
          <Maximize2 size={14} />
        {:else}
          <Minus size={14} />
        {/if}
      </button>
      <button
        type="button"
        aria-label="Close"
        onclick={discard}
        class="rounded p-1 text-zinc-400 transition hover:bg-white/6 hover:text-rose-400"
      >
        <X size={14} />
      </button>
    </div>
  </div>

  {#if !composer.minimized}
    <!-- Fields -->
    <div class="shrink-0 border-b border-white/8">
      <!-- To -->
      <div class="flex items-center border-b border-white/8 px-4">
        <AddressInput
          id="composer-to"
          label="To"
          bind:value={composer.to}
          placeholder="recipients@example.com"
        />
        <div class="flex gap-1 text-xs text-zinc-500">
          {#if !showCc}
            <button type="button" onclick={() => (showCc = true)} class="px-1 hover:text-zinc-300"
              >Cc</button
            >
          {/if}
          {#if !showBcc}
            <button type="button" onclick={() => (showBcc = true)} class="px-1 hover:text-zinc-300"
              >Bcc</button
            >
          {/if}
        </div>
      </div>

      {#if showCc}
        <div class="flex items-center border-b border-white/8 px-4">
          <AddressInput
            id="composer-cc"
            label="Cc"
            bind:value={composer.cc}
            placeholder="cc@example.com"
          />
        </div>
      {/if}

      {#if showBcc}
        <div class="flex items-center border-b border-white/8 px-4">
          <AddressInput
            id="composer-bcc"
            label="Bcc"
            bind:value={composer.bcc}
            placeholder="bcc@example.com"
          />
        </div>
      {/if}

      <!-- Subject -->
      <div class="flex items-center px-4">
        <input
          type="text"
          bind:value={composer.subject}
          placeholder="Subject"
          class="flex-1 bg-transparent py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />
      </div>
    </div>

    <!-- Toolbar -->
    <div
      class="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-white/8 bg-[#16161a] px-2 py-1.5"
    >
      <!-- Undo / Redo -->
      <button
        type="button"
        aria-label="Undo"
        onclick={() => editor?.chain().focus().undo().run()}
        class={btnClass(false)}
      >
        <Undo2 size={14} />
      </button>
      <button
        type="button"
        aria-label="Redo"
        onclick={() => editor?.chain().focus().redo().run()}
        class={btnClass(false)}
      >
        <Redo2 size={14} />
      </button>

      <div class="mx-1 h-4 w-px bg-white/10"></div>

      <!-- Headings -->
      <button
        type="button"
        aria-label="Heading 1"
        onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        class={btnClass(isActive('heading', { level: 1 }))}
      >
        <Heading1 size={14} />
      </button>
      <button
        type="button"
        aria-label="Heading 2"
        onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        class={btnClass(isActive('heading', { level: 2 }))}
      >
        <Heading2 size={14} />
      </button>
      <button
        type="button"
        aria-label="Heading 3"
        onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        class={btnClass(isActive('heading', { level: 3 }))}
      >
        <Heading3 size={14} />
      </button>

      <div class="mx-1 h-4 w-px bg-white/10"></div>

      <!-- Inline marks -->
      <button
        type="button"
        aria-label="Bold"
        onclick={() => editor?.chain().focus().toggleBold().run()}
        class={btnClass(isActive('bold'))}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        aria-label="Italic"
        onclick={() => editor?.chain().focus().toggleItalic().run()}
        class={btnClass(isActive('italic'))}
      >
        <Italic size={14} />
      </button>
      <button
        type="button"
        aria-label="Underline"
        onclick={() => editor?.chain().focus().toggleUnderline().run()}
        class={btnClass(isActive('underline'))}
      >
        <UnderlineIcon size={14} />
      </button>
      <button
        type="button"
        aria-label="Strikethrough"
        onclick={() => editor?.chain().focus().toggleStrike().run()}
        class={btnClass(isActive('strike'))}
      >
        <Strikethrough size={14} />
      </button>
      <button
        type="button"
        aria-label="Inline code"
        onclick={() => editor?.chain().focus().toggleCode().run()}
        class={btnClass(isActive('code'))}
      >
        <Code size={14} />
      </button>

      <div class="mx-1 h-4 w-px bg-white/10"></div>

      <!-- Link -->
      <button
        type="button"
        aria-label="Link"
        onclick={openLinkInput}
        class={btnClass(isActive('link'))}
      >
        <LinkIcon size={14} />
      </button>

      <div class="mx-1 h-4 w-px bg-white/10"></div>

      <!-- Lists -->
      <button
        type="button"
        aria-label="Bullet list"
        onclick={() => editor?.chain().focus().toggleBulletList().run()}
        class={btnClass(isActive('bulletList'))}
      >
        <List size={14} />
      </button>
      <button
        type="button"
        aria-label="Ordered list"
        onclick={() => editor?.chain().focus().toggleOrderedList().run()}
        class={btnClass(isActive('orderedList'))}
      >
        <ListOrdered size={14} />
      </button>
      <button
        type="button"
        aria-label="Blockquote"
        onclick={() => editor?.chain().focus().toggleBlockquote().run()}
        class={btnClass(isActive('blockquote'))}
      >
        <Quote size={14} />
      </button>
      <button
        type="button"
        aria-label="Code block"
        onclick={() => editor?.chain().focus().toggleCodeBlock().run()}
        class={btnClass(isActive('codeBlock'))}
      >
        <Code2 size={14} />
      </button>
      <button
        type="button"
        aria-label="Horizontal rule"
        onclick={() => editor?.chain().focus().setHorizontalRule().run()}
        class={btnClass(false)}
      >
        <HrIcon size={14} />
      </button>

      <div class="mx-1 h-4 w-px bg-white/10"></div>

      <!-- Alignment -->
      <button
        type="button"
        aria-label="Align left"
        onclick={() => editor?.chain().focus().setTextAlign('left').run()}
        class={btnClass(isAlignActive('left'))}
      >
        <AlignLeft size={14} />
      </button>
      <button
        type="button"
        aria-label="Align center"
        onclick={() => editor?.chain().focus().setTextAlign('center').run()}
        class={btnClass(isAlignActive('center'))}
      >
        <AlignCenter size={14} />
      </button>
      <button
        type="button"
        aria-label="Align right"
        onclick={() => editor?.chain().focus().setTextAlign('right').run()}
        class={btnClass(isAlignActive('right'))}
      >
        <AlignRight size={14} />
      </button>
      <button
        type="button"
        aria-label="Justify"
        onclick={() => editor?.chain().focus().setTextAlign('justify').run()}
        class={btnClass(isAlignActive('justify'))}
      >
        <AlignJustify size={14} />
      </button>
    </div>

    <!-- Link input bar -->
    {#if showLinkInput}
      <div
        class="flex shrink-0 items-center gap-2 border-b border-white/8 bg-[#16161a] px-3 py-1.5"
      >
        <LinkIcon size={13} class="shrink-0 text-zinc-500" />
        <input
          type="url"
          bind:value={linkInputValue}
          placeholder="https://example.com"
          onkeydown={(e) => {
            if (e.key === 'Enter') applyLink()
            if (e.key === 'Escape') {
              showLinkInput = false
              linkInputValue = ''
            }
          }}
          class="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onclick={applyLink}
          class="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-500">Apply</button
        >
        <button
          type="button"
          onclick={() => {
            showLinkInput = false
            linkInputValue = ''
          }}
          class="text-zinc-500 hover:text-zinc-300"
        >
          <X size={13} />
        </button>
      </div>
    {/if}

    <!-- Editor -->
    <div class="composer-editor-wrap flex-1 overflow-y-auto">
      <div bind:this={editorEl}></div>
    </div>

    <!-- Footer -->
    <div
      class="flex shrink-0 items-center justify-between border-t border-white/8 bg-[#16161a] px-4 py-2.5"
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          disabled={sending || !composer.to || !composer.subject}
          onclick={send}
          class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={14} />
          {sending ? 'Sending…' : 'Send'}
        </button>
        {#if sendError}
          <p class="text-xs text-rose-400">{sendError}</p>
        {/if}
      </div>
      <button type="button" onclick={discard} class="text-xs text-zinc-500 hover:text-zinc-300">
        Discard
      </button>
    </div>
  {/if}

  <!-- Discard dialog -->
  {#if showDiscardDialog}
    <div
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#18181c]/95"
    >
      <p class="text-sm text-zinc-300">Save this draft?</p>
      <div class="flex gap-3">
        <button
          type="button"
          onclick={saveDraftAndClose}
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Save draft
        </button>
        <button
          type="button"
          onclick={discardAndDelete}
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
        >
          Discard
        </button>
        <button
          type="button"
          onclick={() => (showDiscardDialog = false)}
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(.composer-editor-wrap .ProseMirror) {
    min-height: 180px;
    padding: 1rem;
    color: #e4e4e7; /* zinc-200 */
    font-size: 0.875rem;
    line-height: 1.6;
    outline: none;
  }

  :global(.composer-editor-wrap .ProseMirror p) {
    margin: 0 0 0.5em;
  }

  :global(.composer-editor-wrap .ProseMirror h1) {
    font-size: 1.5rem;
    font-weight: 700;
    color: #fff;
    margin: 0.75em 0 0.25em;
  }

  :global(.composer-editor-wrap .ProseMirror h2) {
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
    margin: 0.75em 0 0.25em;
  }

  :global(.composer-editor-wrap .ProseMirror h3) {
    font-size: 1.1rem;
    font-weight: 600;
    color: #f4f4f5;
    margin: 0.75em 0 0.25em;
  }

  :global(.composer-editor-wrap .ProseMirror ul) {
    list-style: disc;
    padding-left: 1.5rem;
    margin: 0.5em 0;
  }

  :global(.composer-editor-wrap .ProseMirror ol) {
    list-style: decimal;
    padding-left: 1.5rem;
    margin: 0.5em 0;
  }

  :global(.composer-editor-wrap .ProseMirror blockquote) {
    border-left: 3px solid #52525b;
    padding-left: 1rem;
    color: #a1a1aa;
    margin: 0.5em 0;
  }

  :global(.composer-editor-wrap .ProseMirror pre) {
    background: #0a0a0d;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    overflow-x: auto;
    margin: 0.5em 0;
  }

  :global(.composer-editor-wrap .ProseMirror code) {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 0.25rem;
    padding: 0.1em 0.35em;
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    color: #e4e4e7;
  }

  :global(.composer-editor-wrap .ProseMirror pre code) {
    background: transparent;
    padding: 0;
  }

  :global(.composer-editor-wrap .ProseMirror a) {
    color: #60a5fa;
    text-decoration: underline;
  }

  :global(.composer-editor-wrap .ProseMirror hr) {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin: 1rem 0;
  }

  :global(.composer-editor-wrap .ProseMirror .is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    color: #52525b;
    pointer-events: none;
    height: 0;
  }
</style>
