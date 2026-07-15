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
    Minus as HrIcon,
    Paperclip,
    FileText,
    Trash2,
    Sparkles,
    Clock3,
    ChevronDown,
    Braces
  } from 'lucide-svelte'
  import {
    composer,
    closeComposer,
    type ComposerSmtpServer,
    type SignatureProfile
  } from '$lib/composer.svelte'
  import AddressInput from '$lib/components/AddressInput.svelte'
  import CustomSelect, { type SelectValue } from '$lib/components/CustomSelect.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { markdownToHtml } from '$lib/markdown'
  import { notifyMailboxStateChanged } from '$lib/mailbox-state'
  import {
    attachmentSignature,
    MAX_ATTACHMENT_COUNT,
    MAX_ATTACHMENT_SIZE_BYTES,
    MAX_TOTAL_ATTACHMENT_SIZE_BYTES,
    type ComposerAttachment
  } from '$lib/mail-attachments'
  import { normalizeRecipientList, validateRecipientFields } from '$lib/recipients'
  import { toast } from 'svelte-sonner'

  let editorEl = $state<HTMLElement | undefined>(undefined)
  let editor: Editor | null = null
  let sending = $state(false)
  let showCc = $state(false)
  let showBcc = $state(false)
  let showLinkInput = $state(false)
  let linkInputValue = $state('')
  let editorTick = $state(0) // increments on editor transactions to force re-render
  let showDiscardDialog = $state(false)
  let discardDialogWasMinimized = $state(false)
  let attachmentInput = $state<HTMLInputElement | undefined>(undefined)
  let viewportWidth = $state(1024)
  let composingAi = $state(false)
  let aiRewriteMode = $state<RewriteMode | null>(null)
  let aiPreviewHtml = $state('')
  let aiPreviewQuotedHtml = $state('')
  let errorDialogMessage = $state<string | null>(null)
  let attachmentError = $state<string | null>(null)
  let attachmentDragDepth = $state(0)
  let sendLaterAt = $state('')
  let showSendLaterMenu = $state(false)
  let pendingSendWarnings = $state<string[]>([])
  let templates = $state<MessageTemplate[]>([])
  let templatesLoaded = $state(false)
  let loadingTemplates = $state(false)
  let showTemplateMenu = $state(false)
  let showAiMenu = $state(false)
  let markdownMode = $state(false)
  let markdownSource = $state('')
  let loadingSmtpServers = $state(false)

  type MessageTemplate = {
    id: number
    name: string
    subject: string
    html: string
    isSnippet: boolean
  }

  type RewriteMode = 'concise' | 'formal' | 'friendly'
  const rewriteModes: RewriteMode[] = ['concise', 'formal', 'friendly']

  type SendPayload = {
    to: string
    cc: string | null
    bcc: string | null
    subject: string
    html: string
    attachments: ComposerAttachment[]
    inReplyTo: string | null
    smtpServerId?: string | null
    fromName?: string | null
    sendAt?: string
  }

  type PendingUndoSend = {
    jobId: number
    delaySeconds: number
    payload: SendPayload
    timeout: ReturnType<typeof setTimeout>
    canceling: boolean
  }

  let pendingUndoSend = $state<PendingUndoSend | null>(null)

  const isMobile = $derived(viewportWidth < 640)
  const useFullscreenLayout = $derived(composer.fullscreen || (isMobile && !composer.minimized))
  const isAttachmentDragActive = $derived(attachmentDragDepth > 0 && !composer.minimized)
  const recipientValidation = $derived(
    validateRecipientFields({ to: composer.to, cc: composer.cc, bcc: composer.bcc })
  )
  const canSend = $derived(
    !sending && !!composer.subject && recipientValidation.errors.length === 0
  )
  const selectedSmtpServer = $derived(
    composer.smtpServers.find((server) => server.id === composer.selectedSmtpServerId) ??
      composer.smtpServers[0] ??
      null
  )

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
        if (aiPreviewHtml) clearAiPreview()
      }
    })
  })

  // When composer opens, load fresh content and focus
  let prevOpen = false
  $effect(() => {
    if (composer.open && !prevOpen && editor) {
      editor.commands.setContent(composer.initialHtml || '<p></p>')
      const focusPosition =
        composer.mode === 'reply' || composer.mode === 'reply-all' ? 'start' : 'end'
      editor.commands.focus(focusPosition)
      showCc = !!composer.cc
      showBcc = !!composer.bcc
      lastSavedContent = draftSnapshot(composer.initialHtml || '<p></p>')
      clearAiPreview()
      errorDialogMessage = null
      attachmentError = null
      attachmentDragDepth = 0
      pendingSendWarnings = []
      void loadTemplates()
      void loadSmtpServers()
      markdownMode = false
      markdownSource = ''
    }
    if (!composer.open && prevOpen) {
      lastSavedContent = ''
      attachmentDragDepth = 0
      pendingSendWarnings = []
      markdownMode = false
      markdownSource = ''
    }
    prevOpen = composer.open
  })

  // Draft auto-save — every 30 seconds
  let saveDraftTimer: ReturnType<typeof setInterval> | null = null
  let lastSavedContent = ''

  function draftSnapshot(html: string) {
    return `${composer.to}|${composer.cc}|${composer.bcc}|${composer.subject}|${html}|${attachmentSignature(composer.attachments)}`
  }

  function isDirty(html: string) {
    return draftSnapshot(html) !== lastSavedContent
  }

  function currentHtml() {
    if (markdownMode) return markdownToHtml(markdownSource)
    return editor?.getHTML() ?? '<p></p>'
  }

  async function saveDraft() {
    if (!composer.open || !editor) return false
    const html = currentHtml()
    const key = draftSnapshot(html)
    if (key === lastSavedContent) return true // nothing changed

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
          attachments: composer.attachments,
          inReplyTo: composer.inReplyTo
        })
      })
      if (res.ok) {
        const data = await res.json()
        const wasNewDraft = composer.draftId === null
        composer.draftId = data.id
        composer.lastSavedAt = Date.now()
        lastSavedContent = key
        notifyMailboxStateChanged(wasNewDraft ? 'draft-created' : 'draft-updated')
        return true
      }
    } catch {
      // silent — draft save failures shouldn't interrupt composition
    }
    return false
  }

  async function deleteDraft() {
    if (!composer.draftId) return
    const draftId = composer.draftId
    try {
      await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' })
      notifyMailboxStateChanged('draft-deleted')
    } catch {
      // ignore
    }
    composer.draftId = null
  }

  onMount(() => {
    saveDraftTimer = setInterval(saveDraft, 30_000)

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!composer.open || !editor) return
      const html = currentHtml()

      if (composer.attachments.length > 0 && isDirty(html)) {
        event.preventDefault()
        event.returnValue = ''
        return ''
      }

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
      if (pendingUndoSend) clearTimeout(pendingUndoSend.timeout)
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

  function localDateTimeValue(date: Date) {
    const offsetMs = date.getTimezoneOffset() * 60_000
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
  }

  function setSendLater(minutesFromNow: number) {
    sendLaterAt = localDateTimeValue(new Date(Date.now() + minutesFromNow * 60_000))
    showSendLaterMenu = false
  }

  function sendLaterLabel() {
    if (!sendLaterAt) return 'Send later'

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(sendLaterAt))
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

  async function selectSignature(profile: SignatureProfile | null) {
    if (!editor) return

    const currentHtml = editor.getHTML()
    let nextHtml = currentHtml
    if (composer.currentSignatureHtml && currentHtml.endsWith(composer.currentSignatureHtml)) {
      nextHtml = currentHtml.slice(0, -composer.currentSignatureHtml.length)
    }

    if (profile?.html) {
      nextHtml = nextHtml.endsWith('<p></p>')
        ? `${nextHtml}${profile.html}`
        : `${nextHtml}<p></p>${profile.html}`
    }

    composer.selectedSignatureId = profile?.id ?? null
    composer.currentSignatureHtml = profile?.html ?? ''
    editor.commands.setContent(nextHtml || '<p></p>')
    editor.commands.focus('end')
    await saveDraft()
  }

  function handleSignatureChange(value: SelectValue) {
    const id = Number(value)
    const profile = composer.signatureProfiles.find((signature) => signature.id === id) ?? null
    void selectSignature(profile)
  }

  function openLinkInput() {
    const existing = editor?.getAttributes('link').href as string | undefined
    linkInputValue = existing ?? ''
    showLinkInput = true
  }

  async function loadTemplates(force = false) {
    if ((templatesLoaded && !force) || loadingTemplates) return
    loadingTemplates = true
    try {
      const res = await fetch('/api/message-templates')
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to load templates.'))
      const data = (await res.json()) as { templates: MessageTemplate[] }
      templates = data.templates
      templatesLoaded = true
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load templates.')
    } finally {
      loadingTemplates = false
    }
  }

  async function loadSmtpServers() {
    if (loadingSmtpServers || composer.smtpServers.length > 0) return
    loadingSmtpServers = true
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) return
      const data = (await res.json()) as {
        smtpServers?: Array<{ id?: unknown; name?: unknown; from?: unknown }>
      }
      const servers: ComposerSmtpServer[] = Array.isArray(data.smtpServers)
        ? data.smtpServers.flatMap((server) => {
            const id = typeof server.id === 'string' ? server.id.trim() : ''
            const name = typeof server.name === 'string' ? server.name.trim() : ''
            const from = typeof server.from === 'string' ? server.from.trim() : ''
            return id && from ? [{ id, name: name || id, from }] : []
          })
        : []
      composer.smtpServers = servers
      if (
        !composer.selectedSmtpServerId ||
        !servers.some((s) => s.id === composer.selectedSmtpServerId)
      ) {
        composer.selectedSmtpServerId = servers[0]?.id ?? ''
      }
    } finally {
      loadingSmtpServers = false
    }
  }

  async function toggleTemplateMenu() {
    if (!showTemplateMenu) await loadTemplates()
    showTemplateMenu = !showTemplateMenu
  }

  function insertTemplate(template: MessageTemplate) {
    if (!editor) return
    if (markdownMode) {
      editor.commands.setContent(markdownToHtml(markdownSource))
      markdownMode = false
    }
    if (template.subject && !composer.subject.trim()) composer.subject = template.subject
    editor.chain().focus().insertContent(template.html).run()
    showTemplateMenu = false
    void saveDraft()
  }

  function toggleMarkdownMode() {
    if (!editor) return

    if (markdownMode) {
      editor.commands.setContent(markdownToHtml(markdownSource))
      editor.commands.focus('end')
      markdownMode = false
      return
    }

    markdownSource = editor.getText({ blockSeparator: '\n\n' })
    markdownMode = true
    showLinkInput = false
  }

  function splitQuotedHtml(html: string) {
    const quoteIndex = html.search(/<blockquote\b/i)
    if (quoteIndex === -1) return { editableHtml: html, quotedHtml: '' }

    return {
      editableHtml: html.slice(0, quoteIndex),
      quotedHtml: html.slice(quoteIndex)
    }
  }

  function rewriteModeLabel(mode: RewriteMode) {
    if (mode === 'concise') return 'Concise'
    if (mode === 'formal') return 'Formal'
    return 'Friendly'
  }

  function clearAiPreview() {
    aiRewriteMode = null
    aiPreviewHtml = ''
    aiPreviewQuotedHtml = ''
  }

  function previewText(html: string) {
    if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, ' ').trim()
    const preview = document.createElement('div')
    preview.innerHTML = html
    return preview.textContent?.trim() || ''
  }

  async function composeWithAi(rewriteMode?: RewriteMode) {
    if (!editor || composingAi) return

    composingAi = true
    clearAiPreview()

    try {
      if (markdownMode) {
        editor.commands.setContent(markdownToHtml(markdownSource))
        markdownMode = false
      }

      const currentHtml = editor.getHTML()
      const { editableHtml, quotedHtml } = splitQuotedHtml(currentHtml)
      const res = await fetch('/api/ai/compose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: composer.mode,
          to: composer.to,
          cc: composer.cc,
          bcc: composer.bcc,
          subject: composer.subject,
          html: editableHtml,
          rewriteMode
        })
      })

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'AI compose failed.'))
      }

      const data = (await res.json()) as { html?: string }
      if (!data.html) throw new Error('AI compose returned an empty draft.')

      if (rewriteMode) {
        aiRewriteMode = rewriteMode
        aiPreviewHtml = data.html
        aiPreviewQuotedHtml = quotedHtml
        return
      }

      editor.commands.setContent(`${data.html}${quotedHtml}`)
      editor.commands.focus('end')
      await saveDraft()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'AI compose failed.')
    } finally {
      composingAi = false
    }
  }

  async function applyAiPreview() {
    if (!editor || !aiPreviewHtml) return
    editor.commands.setContent(`${aiPreviewHtml}${aiPreviewQuotedHtml}`)
    editor.commands.focus('end')
    clearAiPreview()
    await saveDraft()
  }

  async function send() {
    if (!editor || sending) return
    const validation = validateRecipientFields({
      to: composer.to,
      cc: composer.cc,
      bcc: composer.bcc
    })
    if (validation.errors.length > 0) {
      errorDialogMessage = validation.errors.map((issue) => issue.message).join('\n')
      return
    }

    const warningMessages = validation.warnings.map((issue) => issue.message)
    if (
      warningMessages.length > 0 &&
      warningMessages.join('\n') !== pendingSendWarnings.join('\n')
    ) {
      pendingSendWarnings = warningMessages
      return
    }

    const html = currentHtml()
    const payload: {
      to: string
      cc: string | null
      bcc: string | null
      subject: string
      html: string
      attachments: ComposerAttachment[]
      inReplyTo: string | null
      smtpServerId?: string | null
      fromName?: string | null
      sendAt?: string
    } = {
      to: normalizeRecipientList(composer.to),
      cc: normalizeRecipientList(composer.cc) || null,
      bcc: normalizeRecipientList(composer.bcc) || null,
      subject: composer.subject,
      html,
      attachments: composer.attachments,
      inReplyTo: composer.inReplyTo,
      smtpServerId: composer.selectedSmtpServerId || null,
      fromName: composer.fromName.trim() || null
    }
    if (sendLaterAt) payload.sendAt = new Date(sendLaterAt).toISOString()
    sending = true
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        const data = (await res.json()) as {
          jobId?: number
          undoable?: boolean
          undoSendSeconds?: number
        }
        await deleteDraft()
        sendLaterAt = ''
        pendingSendWarnings = []
        closeComposer()
        if (data.undoable && typeof data.jobId === 'number') {
          showUndoSend(data.jobId, data.undoSendSeconds ?? 0, payload)
        }
      } else {
        errorDialogMessage = await readErrorMessage(res, 'Failed to send message.')
      }
    } catch (e) {
      errorDialogMessage = errorMessageFromUnknown(e, 'Failed to send message.')
    } finally {
      sending = false
    }
  }

  function showUndoSend(jobId: number, delaySeconds: number, payload: SendPayload) {
    if (pendingUndoSend) clearTimeout(pendingUndoSend.timeout)

    const timeout = setTimeout(
      () => {
        pendingUndoSend = null
      },
      Math.max(1, delaySeconds) * 1000
    )

    pendingUndoSend = {
      jobId,
      delaySeconds,
      payload: {
        ...payload,
        attachments: payload.attachments.map((attachment) => ({ ...attachment }))
      },
      timeout,
      canceling: false
    }
  }

  async function undoSend() {
    if (!pendingUndoSend || pendingUndoSend.canceling) return

    pendingUndoSend.canceling = true
    try {
      const res = await fetch(`/api/send/${pendingUndoSend.jobId}/cancel`, { method: 'POST' })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Message is already being sent.'))
      }

      const restored = pendingUndoSend.payload
      clearTimeout(pendingUndoSend.timeout)
      pendingUndoSend = null

      composer.mode = 'compose'
      composer.to = restored.to
      composer.cc = restored.cc ?? ''
      composer.bcc = restored.bcc ?? ''
      composer.subject = restored.subject
      composer.initialHtml = restored.html
      composer.attachments = restored.attachments
      composer.inReplyTo = restored.inReplyTo
      composer.selectedSmtpServerId = restored.smtpServerId ?? ''
      composer.fromName = restored.fromName ?? ''
      composer.draftId = null
      composer.lastSavedAt = 0
      composer.minimized = false
      composer.fullscreen = false
      composer.open = true
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to undo send.')
      if (pendingUndoSend) pendingUndoSend.canceling = false
    }
  }

  function discard() {
    pendingSendWarnings = []
    discardDialogWasMinimized = composer.minimized

    if (composer.minimized) {
      composer.minimized = false
    }

    showDiscardDialog = true
  }

  async function discardAndDelete() {
    await deleteDraft()
    discardDialogWasMinimized = false
    showDiscardDialog = false
    closeComposer()
    toast('Draft discarded')
  }

  async function saveDraftAndClose() {
    const saved = await saveDraft()
    discardDialogWasMinimized = false
    showDiscardDialog = false
    closeComposer()
    if (saved) toast('Draft saved')
  }

  function cancelDiscard() {
    showDiscardDialog = false

    if (discardDialogWasMinimized) {
      composer.minimized = true
      discardDialogWasMinimized = false
    }
  }

  function toggleMinimized() {
    pendingSendWarnings = []
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

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function fileIdentity(file: File) {
    return `${file.name}:${file.size}`
  }

  function attachmentIdentity(attachment: ComposerAttachment) {
    return `${attachment.name}:${attachment.size}`
  }

  function hasDraggedFiles(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
  }

  function showAttachmentError(message: string) {
    attachmentError = message
    errorDialogMessage = message
  }

  function arrayBufferToBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    let binary = ''

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }

    return btoa(binary)
  }

  async function fileToAttachment(file: File): Promise<ComposerAttachment> {
    const buffer = await file.arrayBuffer()

    return {
      name: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      contentBase64: arrayBufferToBase64(buffer)
    }
  }

  async function addAttachmentFiles(files: File[]) {
    if (files.length === 0) return

    if (composer.attachments.length + files.length > MAX_ATTACHMENT_COUNT) {
      showAttachmentError(`You can attach up to ${MAX_ATTACHMENT_COUNT} files.`)
      return
    }

    const existingFiles = composer.attachments.map(attachmentIdentity)
    const newFiles: string[] = []
    const duplicate = files.find((file) => {
      const identity = fileIdentity(file)
      if (existingFiles.includes(identity) || newFiles.includes(identity)) return true
      newFiles.push(identity)
      return false
    })

    if (duplicate) {
      showAttachmentError(`${duplicate.name} is already attached.`)
      return
    }

    const currentTotal = composer.attachments.reduce(
      (sum: number, attachment: ComposerAttachment) => sum + attachment.size,
      0
    )
    const newTotal = files.reduce((sum, file) => sum + file.size, 0)

    if (files.some((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES)) {
      showAttachmentError(`Each file must be ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} or smaller.`)
      return
    }

    if (currentTotal + newTotal > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      showAttachmentError(
        `Attachments can total up to ${formatBytes(MAX_TOTAL_ATTACHMENT_SIZE_BYTES)}.`
      )
      return
    }

    try {
      const attachments = await Promise.all(files.map((file) => fileToAttachment(file)))
      composer.attachments = [...composer.attachments, ...attachments]
      attachmentError = null
      await saveDraft()
    } catch (error) {
      showAttachmentError(errorMessageFromUnknown(error, 'Failed to attach file.'))
    }
  }

  async function handleAttachmentChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''

    await addAttachmentFiles(files)
  }

  function handleAttachmentDragEnter(event: DragEvent) {
    if (!hasDraggedFiles(event) || composer.minimized) return
    event.preventDefault()
    attachmentDragDepth += 1
  }

  function handleAttachmentDragOver(event: DragEvent) {
    if (!hasDraggedFiles(event) || composer.minimized) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function handleAttachmentDragLeave(event: DragEvent) {
    if (!hasDraggedFiles(event) || composer.minimized) return
    event.preventDefault()
    attachmentDragDepth = Math.max(0, attachmentDragDepth - 1)
  }

  async function handleAttachmentDrop(event: DragEvent) {
    if (!hasDraggedFiles(event) || composer.minimized) return
    event.preventDefault()
    attachmentDragDepth = 0
    await addAttachmentFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  async function removeAttachment(index: number) {
    composer.attachments = composer.attachments.filter(
      (_attachment: ComposerAttachment, attachmentIndex: number) => attachmentIndex !== index
    )
    await saveDraft()
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<div
  class={[
    'fixed z-50 flex flex-col overflow-hidden border border-white/10 bg-[#18181c] shadow-2xl',
    useFullscreenLayout
      ? 'inset-0 rounded-none sm:inset-4 sm:rounded-xl'
      : composer.minimized
        ? 'right-0 bottom-0 left-0 rounded-t-xl sm:right-4 sm:left-auto'
        : 'inset-x-0 top-0 bottom-0 rounded-none sm:top-auto sm:right-4 sm:left-auto sm:rounded-t-xl'
  ]}
  style:width={useFullscreenLayout || isMobile ? null : '580px'}
  style:height={useFullscreenLayout || isMobile || composer.minimized ? null : '680px'}
  style:max-height={useFullscreenLayout || isMobile || composer.minimized ? null : '90vh'}
  style:display={composer.open ? 'flex' : 'none'}
  role="dialog"
  aria-label={titleLabel()}
  tabindex="-1"
  ondragenter={handleAttachmentDragEnter}
  ondragover={handleAttachmentDragOver}
  ondragleave={handleAttachmentDragLeave}
  ondrop={handleAttachmentDrop}
>
  <!-- Title bar -->
  <div class="flex shrink-0 items-center justify-between bg-[#1e1e24] px-4 py-3 select-none">
    <span class="text-sm font-medium text-zinc-200">{titleLabel()}</span>
    <div class="flex items-center gap-1">
      <button
        type="button"
        aria-label={composer.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onclick={toggleFullscreen}
        class="hidden rounded p-1 text-zinc-400 transition hover:bg-white/6 hover:text-zinc-200 sm:block"
        style:display={composer.minimized ? 'none' : null}
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
    <div class="max-h-48 shrink-0 overflow-y-auto border-b border-white/8">
      <!-- From -->
      <div class="flex flex-wrap items-center gap-2 border-b border-white/8 px-4 py-2">
        <span class="w-10 shrink-0 text-sm text-zinc-500">From</span>
        <input
          type="text"
          bind:value={composer.fromName}
          placeholder="Display name"
          aria-label="From display name"
          class="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
        />
        {#if composer.smtpServers.length > 0}
          <CustomSelect
            bind:value={composer.selectedSmtpServerId}
            ariaLabel="SMTP server"
            options={composer.smtpServers.map((server) => ({
              value: server.id,
              label: `${server.name} · ${server.from}`
            }))}
            class="min-w-36"
            buttonClass="px-2 py-1 text-xs text-zinc-300"
          />
        {:else if selectedSmtpServer}
          <span class="truncate text-xs text-zinc-500">{selectedSmtpServer.from}</span>
        {:else if loadingSmtpServers}
          <span class="text-xs text-zinc-600">Loading sender...</span>
        {/if}
      </div>

      <!-- To -->
      <div class="flex flex-wrap items-start gap-2 border-b border-white/8 px-4 py-2">
        <AddressInput
          id="composer-to"
          label="To"
          bind:value={composer.to}
          placeholder="recipients@example.com"
        />
        <div class="ml-auto flex shrink-0 gap-1 text-xs text-zinc-500">
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

      {#if recipientValidation.errors.length > 0}
        <div class="border-b border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          {recipientValidation.errors[0].message}
        </div>
      {/if}

      {#if showCc}
        <div class="flex flex-wrap items-start gap-2 border-b border-white/8 px-4 py-2">
          <AddressInput
            id="composer-cc"
            label="Cc"
            bind:value={composer.cc}
            placeholder="cc@example.com"
          />
        </div>
      {/if}

      {#if showBcc}
        <div class="flex flex-wrap items-start gap-2 border-b border-white/8 px-4 py-2">
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
      {#if !markdownMode}
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
      {/if}

      <div class="mx-1 h-4 w-px bg-white/10"></div>

      <button
        type="button"
        aria-label={markdownMode ? 'Switch to rich text mode' : 'Switch to markdown mode'}
        aria-pressed={markdownMode}
        onclick={toggleMarkdownMode}
        class={btnClass(markdownMode)}
        title="Markdown mode"
      >
        <Braces size={14} />
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
    <div class="composer-editor-wrap relative min-h-0 flex-1 overflow-y-auto">
      {#if markdownMode}
        <div
          class="border-b border-amber-400/15 bg-amber-400/8 px-4 py-2 text-xs text-amber-100/85"
        >
          Markdown mode sends and saves converted HTML. Switching from rich text starts from plain
          text, so some existing formatting may not be preserved.
        </div>
        <textarea
          bind:value={markdownSource}
          aria-label="Markdown message body"
          class="min-h-[180px] w-full resize-none bg-transparent p-4 font-mono text-sm leading-6 text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          placeholder="Write markdown, e.g. **bold**, [link](https://example.com), - lists, > quotes"
        ></textarea>
      {/if}
      <div class:hidden={markdownMode} bind:this={editorEl}></div>

      {#if isAttachmentDragActive}
        <div
          class="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400/70 bg-blue-500/10 text-center shadow-[0_0_40px_rgba(59,130,246,0.18)] backdrop-blur-sm"
        >
          <div class="rounded-xl border border-white/10 bg-zinc-950/85 px-5 py-4">
            <Paperclip size={22} class="mx-auto mb-2 text-blue-300" />
            <p class="text-sm font-medium text-blue-100">Drop files to attach</p>
            <p class="mt-1 text-xs text-zinc-400">
              Up to {MAX_ATTACHMENT_COUNT} files, {formatBytes(MAX_TOTAL_ATTACHMENT_SIZE_BYTES)} total
            </p>
          </div>
        </div>
      {/if}
    </div>

    {#if attachmentError}
      <div class="border-t border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
        {attachmentError}
      </div>
    {/if}

    {#if aiPreviewHtml && aiRewriteMode}
      <div class="shrink-0 border-t border-sky-400/20 bg-sky-400/8 px-4 py-3">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-medium tracking-wide text-sky-200 uppercase">
            {rewriteModeLabel(aiRewriteMode)} rewrite preview
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              onclick={applyAiPreview}
              class="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
            >
              Apply
            </button>
            <button
              type="button"
              onclick={clearAiPreview}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
        <div
          class="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-sm leading-6 whitespace-pre-wrap text-zinc-200"
        >
          {previewText(aiPreviewHtml)}
        </div>
      </div>
    {/if}

    {#if composer.attachments.length > 0}
      <div class="border-t border-white/8 bg-[#16161a] px-4 py-3">
        {#if composer.attachments.length > 0}
          <div class="flex flex-wrap gap-2">
            {#each composer.attachments as attachment, index (`${attachment.name}-${attachment.size}-${index}`)}
              <div
                class="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300"
              >
                <FileText size={14} class="shrink-0 text-zinc-400" />
                <div class="min-w-0">
                  <p class="truncate font-medium text-zinc-200">{attachment.name}</p>
                  <p class="text-zinc-500">{formatBytes(attachment.size)}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onclick={() => removeAttachment(index)}
                  class="rounded p-1 text-zinc-500 transition hover:bg-white/8 hover:text-rose-400"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Footer -->
    <div
      class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/8 bg-[#16161a] px-4 py-2.5"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <input
          bind:this={attachmentInput}
          type="file"
          multiple
          class="hidden"
          onchange={handleAttachmentChange}
        />
        <button
          type="button"
          disabled={!canSend}
          onclick={send}
          class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={14} />
          {sending ? 'Sending…' : 'Send'}
        </button>
        <div class="relative">
          <button
            type="button"
            disabled={sending}
            onclick={() => (showSendLaterMenu = !showSendLaterMenu)}
            class={[
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40',
              sendLaterAt
                ? 'border-blue-400/20 bg-blue-400/10 text-blue-200 hover:bg-blue-400/15'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
            ]}
          >
            <Clock3 size={14} />
            {sendLaterLabel()}
            <ChevronDown size={13} />
          </button>

          {#if showSendLaterMenu}
            <div
              class="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40"
            >
              <div class="p-1">
                <button
                  type="button"
                  onclick={() => setSendLater(60)}
                  class="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/8"
                >
                  In 1 hour
                </button>
                <button
                  type="button"
                  onclick={() => setSendLater(240)}
                  class="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/8"
                >
                  In 4 hours
                </button>
                <button
                  type="button"
                  onclick={() => setSendLater(1440)}
                  class="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/8"
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  onclick={() => {
                    sendLaterAt = ''
                    showSendLaterMenu = false
                  }}
                  class="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-400 hover:bg-white/8"
                >
                  Send immediately
                </button>
              </div>
              <div class="border-t border-white/8 p-3">
                <label class="block text-xs text-zinc-500" for="composer-send-later-custom">
                  Custom time
                </label>
                <input
                  id="composer-send-later-custom"
                  type="datetime-local"
                  bind:value={sendLaterAt}
                  class="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-400/40"
                />
              </div>
            </div>
          {/if}
        </div>
        <button
          type="button"
          disabled={sending}
          onclick={() => attachmentInput?.click()}
          class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Paperclip size={14} />
          Attach
        </button>
        <div class="relative">
          <button
            type="button"
            disabled={sending || loadingTemplates}
            onclick={() => void toggleTemplateMenu()}
            class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-40"
          >
            <FileText size={14} />
            {loadingTemplates ? 'Loading...' : 'Templates'}
            <ChevronDown size={13} />
          </button>

          {#if showTemplateMenu}
            <div
              class="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-1 shadow-2xl shadow-black/40"
            >
              {#if templates.length === 0}
                <p class="px-3 py-2 text-sm text-zinc-500">
                  No templates yet. Add them in Settings.
                </p>
              {:else}
                {#each templates as template (template.id)}
                  <button
                    type="button"
                    onclick={() => insertTemplate(template)}
                    class="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/8"
                  >
                    <span class="block truncate text-sm text-zinc-200">{template.name}</span>
                    <span class="mt-0.5 block truncate text-xs text-zinc-500">
                      {template.isSnippet ? 'Snippet' : template.subject || 'Template'}
                    </span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
        {#if composer.mode === 'compose' && composer.draftId === null && composer.signatureProfiles.length > 0}
          <label class="sr-only" for="composer-signature">Signature</label>
          <CustomSelect
            id="composer-signature"
            value={composer.selectedSignatureId ?? ''}
            onchange={handleSignatureChange}
            disabled={sending}
            ariaLabel="Signature"
            options={[
              { value: '', label: 'No signature' },
              ...composer.signatureProfiles.map((signature) => ({
                value: signature.id ?? '',
                label: signature.name
              }))
            ]}
            class="max-w-40"
            buttonClass="px-2 py-1.5 text-sm text-zinc-300"
          />
        {/if}
        <div class="relative">
          <button
            type="button"
            disabled={sending || composingAi}
            onclick={() => (showAiMenu = !showAiMenu)}
            class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-sky-300 disabled:cursor-wait disabled:opacity-40"
          >
            <Sparkles size={14} class={composingAi ? 'animate-pulse' : ''} />
            {composingAi ? 'Writing...' : 'AI'}
            <ChevronDown size={13} />
          </button>
          {#if showAiMenu}
            <div
              class="absolute right-0 bottom-full z-20 mb-2 w-40 rounded-xl border border-white/10 bg-zinc-950 p-1 shadow-xl shadow-black/30"
            >
              <button
                type="button"
                onclick={() => {
                  showAiMenu = false
                  void composeWithAi()
                }}
                class="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/8"
              >
                Improve
              </button>
              {#each rewriteModes as mode (mode)}
                <button
                  type="button"
                  onclick={() => {
                    showAiMenu = false
                    void composeWithAi(mode)
                  }}
                  class="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/8"
                >
                  {rewriteModeLabel(mode)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <button type="button" onclick={discard} class="text-xs text-zinc-500 hover:text-zinc-300">
        Discard
      </button>
    </div>
  {/if}

  {#if pendingSendWarnings.length > 0}
    <div
      class="app-popover absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-6"
    >
      <div
        class="max-w-md rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100"
      >
        <p class="font-medium">Review recipients before sending</p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/90">
          {#each pendingSendWarnings as warning (warning)}
            <li>{warning}</li>
          {/each}
        </ul>
      </div>
      <div class="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onclick={send}
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Send anyway
        </button>
        <button
          type="button"
          onclick={() => (pendingSendWarnings = [])}
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
        >
          Review recipients
        </button>
      </div>
    </div>
  {/if}

  <!-- Discard dialog -->
  {#if showDiscardDialog}
    <div class="app-popover absolute inset-0 z-10 flex flex-col items-center justify-center gap-4">
      <p class="text-sm text-zinc-300">Save this draft?</p>
      <div class="flex flex-wrap justify-center gap-3">
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
          onclick={cancelDiscard}
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>

{#if pendingUndoSend}
  <div
    class="fixed right-4 bottom-4 z-[60] max-w-sm rounded-xl border border-blue-400/20 bg-zinc-950 p-4 shadow-2xl shadow-black/40"
  >
    <p class="text-sm font-medium text-zinc-100">Message queued</p>
    <p class="mt-1 text-sm text-zinc-400">
      Sending starts after {pendingUndoSend.delaySeconds} seconds.
    </p>
    <div class="mt-3 flex items-center gap-3">
      <button
        type="button"
        onclick={undoSend}
        disabled={pendingUndoSend.canceling}
        class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
      >
        {pendingUndoSend.canceling ? 'Undoing...' : 'Undo send'}
      </button>
      <button
        type="button"
        onclick={() => {
          if (pendingUndoSend) clearTimeout(pendingUndoSend.timeout)
          pendingUndoSend = null
        }}
        class="text-sm text-zinc-500 hover:text-zinc-300"
      >
        Dismiss
      </button>
    </div>
  </div>
{/if}

<ErrorDialog
  message={errorDialogMessage}
  title="Composer error"
  onclose={() => (errorDialogMessage = null)}
/>

<style>
  :global(.composer-editor-wrap .ProseMirror) {
    min-height: 300px;
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
