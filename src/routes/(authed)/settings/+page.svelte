<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import ActionModal from '$lib/components/ActionModal.svelte'
  import CustomSelect, { type SelectOption } from '$lib/components/CustomSelect.svelte'
  import ErrorDialog from '$lib/components/ErrorDialog.svelte'
  import { normalizeFilterConditions, type FilterCondition } from '$lib/filter-conditions'
  import { invalidateSignatureCache } from '$lib/composer.svelte'
  import { errorMessageFromUnknown, readErrorMessage } from '$lib/http'
  import { normalizeAllowedSenders } from '$lib/remote-content'
  import { onMount, untrack } from 'svelte'
  import { Trash2, Plus, GripVertical, Download, Upload } from 'lucide-svelte'
  import { toast } from 'svelte-sonner'

  type DensityPreference = 'comfortable' | 'compact' | 'condensed'

  const densityOptions: Array<{
    value: DensityPreference
    label: string
    description: string
  }> = [
    {
      value: 'comfortable',
      label: 'Comfortable',
      description: 'Full previews and roomier spacing.'
    },
    {
      value: 'compact',
      label: 'Compact',
      description: 'Hide previews with the current compact spacing.'
    },
    {
      value: 'condensed',
      label: 'Condensed',
      description: 'Hide previews and reduce list, sidebar, and message spacing.'
    }
  ]
  const TRANSLATION_LANGUAGE_SUGGESTIONS = [
    'Korean',
    'English',
    'Japanese',
    'Chinese (Simplified)',
    'Chinese (Traditional)',
    'Spanish',
    'French',
    'German',
    'Portuguese',
    'Italian',
    'Russian',
    'Arabic',
    'Hindi',
    'Dutch',
    'Turkish',
    'Vietnamese',
    'Thai',
    'Indonesian',
    'Polish',
    'Ukrainian',
    'Hebrew',
    'Greek',
    'Swedish',
    'Norwegian',
    'Danish',
    'Finnish',
    'Czech',
    'Romanian',
    'Hungarian',
    'Malay'
  ]
  const settingsSections = [
    { id: 'imap', label: 'IMAP' },
    { id: 'smtp', label: 'SMTP' },
    { id: 'mailboxes', label: 'Mailboxes' },
    { id: 'oidc', label: 'OIDC' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'interface', label: 'Interface' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'signatures', label: 'Signatures' },
    { id: 'templates', label: 'Templates' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'cleanup', label: 'Cleanup' },
    { id: 'senders', label: 'Senders' },
    { id: 'filters', label: 'Filters' },
    { id: 'backup', label: 'Backup' }
  ]
  const undoSendOptions: SelectOption[] = [
    { value: 0, label: 'Off' },
    { value: 5, label: '5 seconds' },
    { value: 10, label: '10 seconds' },
    { value: 20, label: '20 seconds' },
    { value: 30, label: '30 seconds' }
  ]
  const themeOptions: SelectOption[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ]
  const senderRuleTypeOptions: SelectOption[] = [
    { value: 'block', label: 'Block' },
    { value: 'allow', label: 'Allow' }
  ]
  const importConflictOptions: SelectOption[] = [
    { value: 'skip', label: 'Skip' },
    { value: 'duplicate', label: 'Import anyway' }
  ]
  const filterMatchOptions: SelectOption[] = [
    { value: 'all', label: 'All conditions' },
    { value: 'any', label: 'Any condition' }
  ]
  const filterFieldOptions: SelectOption[] = [
    { value: 'from', label: 'From' },
    { value: 'to', label: 'To' },
    { value: 'subject', label: 'Subject' },
    { value: 'cc', label: 'CC' }
  ]
  const filterOperatorOptions: SelectOption[] = [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' }
  ]
  const filterActionOptions: SelectOption[] = [
    { value: 'mark_read', label: 'Mark as read' },
    { value: 'trash', label: 'Move to trash' },
    { value: 'delete', label: 'Delete' },
    { value: 'star', label: 'Star' },
    { value: 'label', label: 'Apply label' },
    { value: 'forward', label: 'Forward (not active yet)' },
    { value: 'auto_reply', label: 'Auto-reply (not active yet)' },
    { value: 'move', label: 'Move to folder…' }
  ]

  type ConfigSection = {
    id: string
    name: string
    host: string
    port: number
    secure: boolean
    user: string
    password: string
    mailbox?: string
    pollSeconds?: number
    from?: string
    source: 'db' | 'env'
  }

  type Props = {
    data: {
      config: {
        signature: string
        signatureProfiles: SignatureProfile[]
        imap: ConfigSection & { mailbox: string; pollSeconds: number }
        imapServers: Array<ConfigSection & { mailbox: string; pollSeconds: number }>
        smtp: ConfigSection & { from: string }
        smtpServers: Array<ConfigSection & { from: string }>
        oidc: {
          discoveryUrl: string
          clientId: string
          clientSecret: string
          source: 'db' | 'env'
        }
        secretStorage: {
          configured: boolean
          text: string
        }
        quietHours: {
          enabled: boolean
          start: string
          end: string
          timezone: string
        }
      }
      imapMailboxes: ImapMailbox[]
      origin: string
      simplifiedView: boolean
      threadModeOnPageLoad: boolean
      density: DensityPreference
      compactMode: boolean
      themePreference: ThemePreference
      translationTargetLanguage: string
      remoteContent: {
        blockRemoteContent: boolean
        allowedSenders: string[]
      }
      mailboxPreferences: MailboxPreferences
    }
  }

  type ThemePreference = 'light' | 'dark' | 'system'
  type ImapMailbox = { path: string; name: string; delimiter: string }
  type MailboxPreferences = { order: string[]; hidden: string[] }

  type ImapForm = Props['data']['config']['imap'] & { password: string }
  type SmtpForm = Props['data']['config']['smtp'] & { password: string; undoSendSeconds: number }
  type ImapServerForm = Props['data']['config']['imapServers'][number] & {
    password: string
    formKey: string
  }
  type SmtpServerForm = Props['data']['config']['smtpServers'][number] & {
    password: string
    formKey: string
  }
  type OidcForm = Props['data']['config']['oidc'] & { clientSecret: string }
  type SignatureProfile = {
    id?: number
    name: string
    html: string
    isDefault: boolean
  }

  let serverFormKeyCounter = 0

  function createServerFormKey(prefix: string) {
    serverFormKeyCounter += 1
    return `${prefix}-${serverFormKeyCounter}`
  }

  class SettingsFormState {
    imap = $state({} as ImapForm)
    imapServers = $state<ImapServerForm[]>([])
    smtp = $state({} as SmtpForm)
    smtpServers = $state<SmtpServerForm[]>([])
    oidc = $state({} as OidcForm)
    signature = $state('')
    signatureProfiles = $state<SignatureProfile[]>([])
    simplifiedView = $state(false)
    threadModeOnPageLoad = $state(true)
    compactMode = $state(false)
    themePreference = $state<ThemePreference>('system')
    density = $state<DensityPreference>('comfortable')
    translationTargetLanguage = $state('Korean')
    blockRemoteContent = $state(true)
    remoteContentAllowedSenders = $state('')
    mailboxPreferences = $state<MailboxPreferences>({ order: [], hidden: [] })
    quietHours = $state({ enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' })

    constructor(
      config: Props['data']['config'],
      simplifiedView: boolean,
      threadModeOnPageLoad: boolean,
      compactMode: boolean,
      themePreference: ThemePreference,
      density: DensityPreference,
      translationTargetLanguage: string,
      remoteContent: Props['data']['remoteContent'],
      mailboxPreferences: MailboxPreferences
    ) {
      this.imap = { ...config.imap, password: '' }
      this.imapServers = config.imapServers.slice(1).map((server) => ({
        ...server,
        password: '',
        formKey: createServerFormKey('imap')
      }))
      const smtpConfig = config.smtp as Props['data']['config']['smtp'] & {
        undoSendSeconds?: number
      }
      this.smtp = {
        ...config.smtp,
        password: '',
        undoSendSeconds: smtpConfig.undoSendSeconds ?? 0
      }
      this.smtpServers = config.smtpServers.slice(1).map((server) => ({
        ...server,
        password: '',
        formKey: createServerFormKey('smtp')
      }))
      this.oidc = { ...config.oidc, clientSecret: '' }
      this.signature = config.signature
      this.signatureProfiles =
        config.signatureProfiles.length > 0
          ? config.signatureProfiles.map((signature) => ({
              id: signature.id,
              name: signature.name,
              html: signature.html,
              isDefault: signature.isDefault
            }))
          : [{ name: 'Default', html: config.signature, isDefault: true }]
      this.simplifiedView = simplifiedView
      this.threadModeOnPageLoad = threadModeOnPageLoad
      this.compactMode = compactMode
      this.themePreference = themePreference
      this.density = density
      this.translationTargetLanguage = translationTargetLanguage
      this.blockRemoteContent = remoteContent.blockRemoteContent
      this.remoteContentAllowedSenders = remoteContent.allowedSenders.join('\n')
      this.mailboxPreferences = {
        order: [...mailboxPreferences.order],
        hidden: [...mailboxPreferences.hidden]
      }
      this.quietHours = { ...config.quietHours }
    }
  }
  let { data }: Props = $props()
  const selectedSettingsSection = $derived.by(() => {
    const section = page.params.section ?? 'imap'
    return settingsSections.some((item) => item.id === section) ? section : 'imap'
  })

  function settingsSectionClass(id: string) {
    return selectedSettingsSection === id ? 'space-y-4' : 'hidden'
  }

  // Editable form state must not be derived from `data`: autosave can invalidate route data,
  // and rebuilding this object while typing remounts inputs and drops focus.
  let form = untrack(
    () =>
      new SettingsFormState(
        data.config,
        data.simplifiedView,
        data.threadModeOnPageLoad,
        data.compactMode,
        data.themePreference,
        data.density,
        data.translationTargetLanguage,
        data.remoteContent,
        data.mailboxPreferences
      )
  )
  let imap = $derived(form.imap)
  let imapServers = $derived(form.imapServers)
  let smtp = $derived(form.smtp)
  let smtpServers = $derived(form.smtpServers)
  let oidc = $derived(form.oidc)
  let simplifiedView = $derived(form.simplifiedView)
  let threadModeOnPageLoad = $derived(form.threadModeOnPageLoad)
  let compactMode = $derived(form.compactMode)
  let themePreference = $derived(form.themePreference)
  let density = $derived(form.density)
  let translationTargetLanguage = $derived(form.translationTargetLanguage)
  let blockRemoteContent = $derived(form.blockRemoteContent)
  let remoteContentAllowedSenders = $derived(form.remoteContentAllowedSenders)
  let mailboxPreferences = $derived(form.mailboxPreferences)
  let signatureProfiles = $derived(form.signatureProfiles)
  let quietHours = $derived(form.quietHours)
  let imapPrimaryUsesLegacyFields = $derived(
    data.config.imapServers.length === 0 || data.config.imapServers[0]?.id === 'primary'
  )
  let smtpPrimaryUsesLegacyFields = $derived(
    data.config.smtpServers.length === 0 || data.config.smtpServers[0]?.id === 'primary'
  )

  function applyThemePreference(preference: ThemePreference) {
    const resolvedTheme =
      preference === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : preference

    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = preference
    document.documentElement.style.colorScheme = resolvedTheme
  }

  type Filter = {
    id: number
    field: string
    operator: string
    value: string
    conditions: unknown
    action: string
    target: string | null
    enabled: boolean
    sortOrder: number
  }

  type MessageTemplate = {
    id: number
    name: string
    subject: string
    html: string
    isSnippet: boolean
  }

  type FilterPreviewMatch = {
    id: number
    subject: string
    from: string
    mailbox: string
    receivedAt: string | null
  }

  const FILTER_ACTION_LABELS: Record<string, string> = {
    mark_read: 'Mark as read',
    trash: 'Move to trash',
    delete: 'Delete',
    star: 'Star',
    label: 'Apply label',
    forward: 'Forward',
    auto_reply: 'Auto-reply'
  }

  type FilterImportIssue = {
    index: number
    message: string
  }

  type FilterImportCandidate = {
    index: number
    rule: Omit<Filter, 'id' | 'sortOrder'> & { sort_order: number }
    duplicate: boolean
  }

  type FilterImportPreview = {
    ok: boolean
    issues: FilterImportIssue[]
    candidates: FilterImportCandidate[]
    importableCount: number
    duplicateCount: number
  }

  type ManagedSession = {
    id: string
    createdAt: string
    updatedAt: string
    expiresAt: string
    ipAddress: string | null
    userAgent: string | null
    deviceLabel: string
    isCurrent: boolean
  }

  type CleanupRule = {
    id: number
    enabled: boolean
    mailbox: string | null
    minAgeDays: number
    action: 'archive'
    lastRunAt: string | null
  }

  type SenderRule = {
    id: number
    type: 'block' | 'allow'
    sender: string
    normalizedSender: string
    createdAt: string
  }

  type MailboxNotificationRule = {
    mailbox: string
    enabled: boolean
    canNotify: boolean
  }

  let filters = $state<Filter[]>([])
  let templates = $state<MessageTemplate[]>([])
  let cleanupRules = $state<CleanupRule[]>([])
  let senderRules = $state<SenderRule[]>([])
  let mailboxNotificationRules = $state<MailboxNotificationRule[]>([])
  let showAddFilter = $state(false)
  let showAddTemplate = $state(false)
  let showAddCleanupRule = $state(false)
  let showAddSenderRule = $state(false)
  let editingTemplateId = $state<number | null>(null)
  let savingTemplate = $state(false)
  let errorDialogMessage = $state<string | null>(null)
  let filterPreview = $state<FilterPreviewMatch[]>([])
  let cleanupPreview = $state<FilterPreviewMatch[]>([])
  let previewingFilter = $state(false)
  let previewingCleanup = $state(false)
  let runningFilters = $state(false)
  let runningCleanup = $state(false)
  let filterRunMessage = $state<string | null>(null)
  let sessions = $state<ManagedSession[]>([])
  let loadingSessions = $state(false)
  let revokingSessionId = $state<string | null>(null)
  let actionModal = $state<{
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
    resolve: (value: boolean | null) => void
  } | null>(null)
  let cleanupRunMessage = $state<string | null>(null)
  let exportingFilters = $state(false)
  let importingFilters = $state(false)
  let importConflictStrategy = $state<'skip' | 'duplicate'>('skip')
  let filterImportPayload = $state<unknown>(null)
  let filterImportPreview = $state<FilterImportPreview | null>(null)
  let filterImportMessage = $state<string | null>(null)
  let exportingSettings = $state(false)
  let importingSettings = $state(false)
  let settingsBackupFile = $state<File | null>(null)
  let settingsBackupMessage = $state<string | null>(null)
  let restoreSettings = $state(true)
  let restorePreferences = $state(true)
  let restoreFilters = $state(true)
  let restoreSavedSearches = $state(true)
  let newFilter = $state({
    match: 'all' as 'all' | 'any',
    conditions: [createDefaultCondition()],
    action: 'mark_read',
    target: ''
  })
  let newTemplate = $state({
    name: '',
    subject: '',
    html: '',
    isSnippet: false
  })
  let newCleanupRule = $state({
    mailbox: '',
    minAgeDays: 90
  })
  let newSenderRule = $state({ type: 'block' as 'block' | 'allow', sender: '' })

  function createImapServer(index = imapServers.length): ImapServerForm {
    const ordinal = index + 2
    return {
      id: `server-${ordinal}`,
      name: `Server ${ordinal}`,
      host: '',
      port: 993,
      secure: true,
      user: '',
      password: '',
      mailbox: 'INBOX',
      pollSeconds: 15,
      formKey: createServerFormKey('imap'),
      source: 'db'
    }
  }

  function createSmtpServer(index = smtpServers.length): SmtpServerForm {
    const ordinal = index + 2
    return {
      id: `server-${ordinal}`,
      name: `Server ${ordinal}`,
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      from: '',
      formKey: createServerFormKey('smtp'),
      source: 'db'
    }
  }

  function addImapServer() {
    form.imapServers = [...form.imapServers, createImapServer()]
  }

  function removeImapServer(index: number) {
    form.imapServers = form.imapServers.filter((_, currentIndex) => currentIndex !== index)
  }

  function addSmtpServer() {
    form.smtpServers = [...form.smtpServers, createSmtpServer()]
  }

  function removeSmtpServer(index: number) {
    form.smtpServers = form.smtpServers.filter((_, currentIndex) => currentIndex !== index)
  }

  function imapServerPayload() {
    return imapPrimaryUsesLegacyFields ? imapServers : [imap, ...imapServers]
  }

  function smtpServerPayload() {
    return smtpPrimaryUsesLegacyFields ? smtpServers : [smtp, ...smtpServers]
  }

  async function loadTemplates() {
    try {
      const res = await fetch('/api/message-templates')
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to load templates.'))
      }

      const data = await res.json()
      templates = data.templates as MessageTemplate[]
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load templates.')
    }
  }

  function resetNewTemplate() {
    newTemplate = { name: '', subject: '', html: '', isSnippet: false }
  }

  async function addTemplate() {
    if (!newTemplate.name.trim() || !newTemplate.html.trim()) return
    savingTemplate = true
    try {
      const res = await fetch('/api/message-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newTemplate)
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to add template.'))

      await loadTemplates()
      resetNewTemplate()
      showAddTemplate = false
      toast.success('Template created')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to add template.')
    } finally {
      savingTemplate = false
    }
  }

  async function updateTemplate(template: MessageTemplate) {
    if (!template.name.trim() || !template.html.trim()) return
    savingTemplate = true
    try {
      const res = await fetch(`/api/message-templates/${template.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(template)
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to update template.'))

      editingTemplateId = null
      await loadTemplates()
      toast.success('Template updated')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to update template.')
    } finally {
      savingTemplate = false
    }
  }

  async function deleteTemplate(id: number) {
    try {
      const res = await fetch(`/api/message-templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to delete template.'))

      await loadTemplates()
      toast.success('Template deleted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to delete template.')
    }
  }

  const filterTargetRequired = $derived(
    newFilter.action === 'move' ||
      newFilter.action === 'label' ||
      newFilter.action === 'forward' ||
      newFilter.action === 'auto_reply'
  )

  const filterActionUnavailable = $derived(
    newFilter.action === 'forward' || newFilter.action === 'auto_reply'
  )

  function filterActionDescription(filter: Filter) {
    if (filter.action === 'move') return `Move to ${filter.target}`
    if (filter.action === 'label') return `Apply label ${filter.target}`
    if (filter.action === 'forward') return `Forward to ${filter.target}`
    if (filter.action === 'auto_reply') return `Auto-reply with ${filter.target}`
    return FILTER_ACTION_LABELS[filter.action] ?? filter.action
  }

  function createDefaultCondition(): FilterCondition {
    return { field: 'from', operator: 'contains', value: '' }
  }

  function filterConditionSet(filter: Filter) {
    return normalizeFilterConditions(filter.conditions, {
      field: filter.field,
      operator: filter.operator,
      value: filter.value
    })
  }

  function filterSummary(filter: Filter) {
    const conditionSet = filterConditionSet(filter)
    const joiner = conditionSet.match === 'any' ? ' OR ' : ' AND '
    return conditionSet.conditions
      .map((condition) => `${condition.field} ${condition.operator} "${condition.value}"`)
      .join(joiner)
  }

  function newFilterConditionSet() {
    return normalizeFilterConditions({
      version: 1,
      match: newFilter.match,
      conditions: newFilter.conditions
    })
  }

  function resetNewFilter() {
    newFilter = {
      match: 'all',
      conditions: [createDefaultCondition()],
      action: 'mark_read',
      target: ''
    }
  }

  function addFilterCondition() {
    newFilter.conditions = [...newFilter.conditions, createDefaultCondition()]
  }

  function removeFilterCondition(index: number) {
    if (newFilter.conditions.length === 1) return
    newFilter.conditions = newFilter.conditions.filter(
      (_, conditionIndex) => conditionIndex !== index
    )
  }

  async function loadFilters() {
    try {
      const res = await fetch('/api/filters')
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to load filters.'))
      }

      const data = await res.json()
      filters = data.filters as Filter[]
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load filters.')
    }
  }

  async function loadSessions() {
    loadingSessions = true
    try {
      const res = await fetch('/api/settings/sessions')
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to load sessions.'))
      }

      const data = (await res.json()) as { sessions: ManagedSession[] }
      sessions = data.sessions
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load sessions.')
    } finally {
      loadingSessions = false
    }
  }

  function formatSessionDate(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  }

  async function revokeSession(session: ManagedSession) {
    const confirmCurrentSession =
      session.isCurrent &&
      (await requestConfirm({
        title: 'Revoke current session',
        message: 'This will sign you out of this browser. Continue revoking this session?',
        confirmLabel: 'Revoke session',
        tone: 'danger'
      }))

    if (session.isCurrent && !confirmCurrentSession) return

    revokingSessionId = session.id
    try {
      const res = await fetch(`/api/settings/sessions/${session.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmCurrentSession })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to revoke session.'))
      }

      const payload = (await res.json()) as { currentSessionRevoked?: boolean }
      if (payload.currentSessionRevoked) {
        toast.success('Session revoked')
        await goto(resolve('/login'))
        return
      }

      await loadSessions()
      toast.success('Session revoked')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to revoke session.')
    } finally {
      revokingSessionId = null
    }
  }

  function requestConfirm(options: Omit<NonNullable<typeof actionModal>, 'resolve'>) {
    return new Promise<boolean | null>((resolve) => {
      actionModal = { ...options, resolve }
    })
  }

  function closeActionModal(value: boolean | null) {
    actionModal?.resolve(value)
    actionModal = null
  }

  async function loadCleanupRules() {
    try {
      const res = await fetch('/api/cleanup-rules')
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to load cleanup rules.'))
      }

      const data = await res.json()
      cleanupRules = data.rules as CleanupRule[]
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load cleanup rules.')
    }
  }

  async function loadSenderRules() {
    try {
      const res = await fetch('/api/sender-rules')
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to load sender rules.'))
      }

      const data = await res.json()
      senderRules = data.rules as SenderRule[]
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to load sender rules.')
    }
  }

  async function addSenderRule() {
    if (!newSenderRule.sender.trim()) return
    try {
      const res = await fetch('/api/sender-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newSenderRule)
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to add sender rule.'))
      }

      await loadSenderRules()
      showAddSenderRule = false
      newSenderRule = { type: 'block', sender: '' }
      toast.success('Sender rule created')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to add sender rule.')
    }
  }

  async function deleteSenderRule(id: number) {
    try {
      const res = await fetch(`/api/sender-rules/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to delete sender rule.'))
      }

      await loadSenderRules()
      toast.success('Sender rule deleted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to delete sender rule.')
    }
  }

  async function loadMailboxNotificationRules() {
    try {
      const res = await fetch('/api/mailbox-notifications')
      if (!res.ok) {
        throw new Error(
          await readErrorMessage(res, 'Failed to load mailbox notification settings.')
        )
      }

      const data = (await res.json()) as { rules: MailboxNotificationRule[] }
      mailboxNotificationRules = data.rules
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(
        error,
        'Failed to load mailbox notification settings.'
      )
    }
  }

  async function setMailboxNotifications(rule: MailboxNotificationRule, enabled: boolean) {
    const previousRules = mailboxNotificationRules.map((item) => ({ ...item }))
    mailboxNotificationRules = mailboxNotificationRules.map((item) =>
      item.mailbox === rule.mailbox ? { ...item, enabled } : item
    )

    try {
      const res = await fetch('/api/mailbox-notifications', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mailbox: rule.mailbox, enabled })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to update mailbox notifications.'))
      }
      toast.success(enabled ? 'Mailbox notifications enabled' : 'Mailbox notifications disabled')
    } catch (error) {
      mailboxNotificationRules = previousRules
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to update mailbox notifications.')
    }
  }

  async function addFilter() {
    const conditionSet = newFilterConditionSet()
    const firstCondition = conditionSet.conditions[0]
    if (!firstCondition) return
    try {
      const res = await fetch('/api/filters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          field: firstCondition.field,
          operator: firstCondition.operator,
          value: firstCondition.value,
          conditions: conditionSet,
          action: newFilter.action,
          target: filterTargetRequired ? newFilter.target : null,
          sort_order: filters.length
        })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to add filter.'))
      }

      await loadFilters()
      showAddFilter = false
      resetNewFilter()
      toast.success('Filter created')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to add filter.')
    }
  }

  async function addCleanupRule() {
    try {
      const res = await fetch('/api/cleanup-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newCleanupRule)
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to add cleanup rule.'))
      }

      await loadCleanupRules()
      showAddCleanupRule = false
      cleanupPreview = []
      newCleanupRule = { mailbox: '', minAgeDays: 90 }
      toast.success('Cleanup rule created')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to add cleanup rule.')
    }
  }

  async function previewNewFilter() {
    const conditionSet = newFilterConditionSet()
    if (conditionSet.conditions.length === 0) return
    previewingFilter = true
    try {
      const res = await fetch('/api/filters/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...newFilter, conditions: conditionSet })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to preview filter.'))
      const payload = (await res.json()) as { matches: FilterPreviewMatch[] }
      filterPreview = payload.matches
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to preview filter.')
    } finally {
      previewingFilter = false
    }
  }

  async function previewNewCleanupRule() {
    previewingCleanup = true
    try {
      const res = await fetch('/api/cleanup-rules/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newCleanupRule)
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to preview cleanup rule.'))
      const payload = (await res.json()) as { matches: FilterPreviewMatch[] }
      cleanupPreview = payload.matches
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to preview cleanup rule.')
    } finally {
      previewingCleanup = false
    }
  }

  async function runFiltersNow() {
    runningFilters = true
    filterRunMessage = null
    try {
      const res = await fetch('/api/filters/run', { method: 'POST' })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to run filters.'))
      const payload = (await res.json()) as { scanned: number }
      filterRunMessage = `Scanned ${payload.scanned} messages.`
      toast.success(`Filters ran on ${payload.scanned} messages`)
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to run filters.')
    } finally {
      runningFilters = false
    }
  }

  async function runCleanupNow() {
    runningCleanup = true
    cleanupRunMessage = null
    try {
      const res = await fetch('/api/cleanup-rules/run', { method: 'POST' })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to run cleanup rules.'))
      const payload = (await res.json()) as { archived: number }
      cleanupRunMessage = `Archived ${payload.archived} old messages.`
      await loadCleanupRules()
      toast.success(`${payload.archived} old message${payload.archived === 1 ? '' : 's'} archived`)
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to run cleanup rules.')
    } finally {
      runningCleanup = false
    }
  }

  async function exportFilters() {
    exportingFilters = true
    try {
      const res = await fetch('/api/filters/export')
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to export filters.'))
      const payload = await res.json()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `mail-filter-rules-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to export filters.')
    } finally {
      exportingFilters = false
    }
  }

  async function selectFilterImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    importingFilters = true
    filterImportMessage = null
    try {
      filterImportPayload = JSON.parse(await file.text())
      await previewFilterImport()
    } catch (error) {
      filterImportPayload = null
      filterImportPreview = null
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to read filter import file.')
    } finally {
      importingFilters = false
    }
  }

  async function previewFilterImport() {
    if (!filterImportPayload) return
    const res = await fetch('/api/filters/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payload: filterImportPayload,
        conflictStrategy: importConflictStrategy
      })
    })
    if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to preview import.'))
    filterImportPreview = (await res.json()) as FilterImportPreview
  }

  async function applyFilterImport() {
    if (!filterImportPayload || !filterImportPreview?.ok) return
    importingFilters = true
    filterImportMessage = null
    try {
      const res = await fetch('/api/filters/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload: filterImportPayload,
          apply: true,
          conflictStrategy: importConflictStrategy
        })
      })
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to import filters.'))
      const payload = (await res.json()) as { imported: number; skippedDuplicates: number }
      filterImportMessage = `Imported ${payload.imported} rules. Skipped ${payload.skippedDuplicates} duplicates.`
      filterImportPayload = null
      filterImportPreview = null
      await loadFilters()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to import filters.')
    } finally {
      importingFilters = false
    }
  }

  async function exportSettingsBackup() {
    exportingSettings = true
    settingsBackupMessage = null
    try {
      const res = await fetch('/api/settings/backup')
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to export settings.'))

      const text = await res.text()
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      link.href = url
      link.download = `mail-settings-${stamp}.json`
      link.click()
      URL.revokeObjectURL(url)
      settingsBackupMessage = 'Settings backup exported.'
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to export settings.')
    } finally {
      exportingSettings = false
    }
  }

  function selectSettingsBackupFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    settingsBackupFile = input.files?.[0] ?? null
    settingsBackupMessage = null
  }

  async function importSettingsBackup() {
    if (!settingsBackupFile) return

    importingSettings = true
    settingsBackupMessage = null
    try {
      const backup = JSON.parse(await settingsBackupFile.text())
      const res = await fetch('/api/settings/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          backup,
          restore: {
            settings: restoreSettings,
            preferences: restorePreferences,
            filters: restoreFilters,
            savedSearches: restoreSavedSearches
          }
        })
      })

      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to import settings.'))

      settingsBackupMessage = 'Settings backup imported.'
      settingsBackupFile = null
      await loadFilters()
      await invalidateAll()
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to import settings.')
    } finally {
      importingSettings = false
    }
  }

  async function deleteFilter(id: number) {
    try {
      const res = await fetch(`/api/filters/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to delete filter.'))
      }

      await loadFilters()
      toast.success('Filter deleted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to delete filter.')
    }
  }

  async function deleteCleanupRule(id: number) {
    try {
      const res = await fetch(`/api/cleanup-rules/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to delete cleanup rule.'))
      }

      await loadCleanupRules()
      toast.success('Cleanup rule deleted')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to delete cleanup rule.')
    }
  }

  async function toggleFilter(filter: Filter) {
    try {
      const res = await fetch(`/api/filters/${filter.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !filter.enabled })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to update filter.'))
      }

      await loadFilters()
      toast.success(filter.enabled ? 'Filter disabled' : 'Filter enabled')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to update filter.')
    }
  }

  async function toggleCleanupRule(rule: CleanupRule) {
    try {
      const res = await fetch(`/api/cleanup-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled })
      })
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'Failed to update cleanup rule.'))
      }

      await loadCleanupRules()
      toast.success(rule.enabled ? 'Cleanup rule disabled' : 'Cleanup rule enabled')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to update cleanup rule.')
    }
  }

  let notifStatus = $state<'idle' | 'generating' | 'done' | 'error'>('idle')
  let notifPublicKey = $state('')
  let pushStatus = $state<'unknown' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'>(
    'unknown'
  )
  let subscribing = $state(false)
  let testingPush = $state(false)

  onMount(async () => {
    applyThemePreference(data.themePreference)
    lastSavedSettingsSnapshot = settingsSnapshot()
    autosaveReady = true
    void loadFilters()
    void loadTemplates()
    void loadSessions()
    void loadCleanupRules()
    void loadSenderRules()
    void loadMailboxNotificationRules()

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      pushStatus = 'unsupported'
      return
    }
    if (Notification.permission === 'denied') {
      pushStatus = 'denied'
      return
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      if (!reg) {
        pushStatus = 'unsubscribed'
        return
      }
      const sub = await reg.pushManager.getSubscription()
      pushStatus = sub ? 'subscribed' : 'unsubscribed'
    } catch {
      pushStatus = 'unsubscribed'
    }
  })

  async function enablePushNotifications() {
    subscribing = true
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready

      const res = await fetch('/api/push/vapid-public-key')
      const { publicKey } = await res.json()
      if (!publicKey) {
        errorDialogMessage = 'VAPID keys not configured. Generate them below first.'
        return
      }

      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        pushStatus = 'subscribed'
        toast.success('Push notifications already enabled')
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        pushStatus = permission === 'denied' ? 'denied' : 'unsubscribed'
        return
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey
      })

      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON())
      })

      if (!subRes.ok) {
        throw new Error(await readErrorMessage(subRes, 'Failed to subscribe.'))
      }

      pushStatus = 'subscribed'
      toast.success('Push notifications enabled')
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to enable notifications.')
    } finally {
      subscribing = false
    }
  }

  async function testPush() {
    testingPush = true
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      if (!res.ok) {
        errorDialogMessage = await readErrorMessage(res, 'Failed to send test notification.')
      } else {
        toast.success('Test notification sent')
      }
    } catch (error) {
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to send test notification.')
    } finally {
      testingPush = false
    }
  }

  async function generateVapid() {
    notifStatus = 'generating'
    try {
      const res = await fetch('/api/push/generate-vapid', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        notifPublicKey = data.publicKey
        notifStatus = 'done'
        toast.success('VAPID keys generated')
      } else {
        notifStatus = 'idle'
        errorDialogMessage = await readErrorMessage(res, 'Failed to generate VAPID keys.')
      }
    } catch (error) {
      notifStatus = 'idle'
      errorDialogMessage = errorMessageFromUnknown(error, 'Failed to generate VAPID keys.')
    }
  }

  let saving = $state(false)
  let autosaveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
  let testingImap = $state(false)
  let testingSmtp = $state(false)
  let saveSuccess = $state(false)
  let imapTestResult = $state<string | null>(null)
  let smtpTestResult = $state<string | null>(null)
  let showTranslationLanguageSuggestions = $state(false)
  let translationLanguageHighlightIndex = $state(-1)
  let translationLanguageBlurTimer: ReturnType<typeof setTimeout> | null = null
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  let autosaveReady = false
  let lastSavedSettingsSnapshot = ''
  const translationLanguageListboxId = 'translation-target-language-listbox'

  function settingsSnapshot() {
    return JSON.stringify({
      imap,
      imapServers,
      smtp,
      smtpServers,
      oidc,
      signature: defaultSignatureHtml(),
      signatureProfiles,
      simplifiedView,
      threadModeOnPageLoad,
      compactMode,
      themePreference,
      density,
      translationTargetLanguage,
      blockRemoteContent,
      remoteContentAllowedSenders,
      mailboxPreferences,
      quietHours
    })
  }

  const mailboxPreferenceRows = $derived.by(() => {
    const byPath = new Map(data.imapMailboxes.map((mailbox) => [mailbox.path, mailbox]))
    const orderedPaths = [
      ...mailboxPreferences.order.filter((path) => byPath.has(path)),
      ...data.imapMailboxes
        .map((mailbox) => mailbox.path)
        .filter((path) => !mailboxPreferences.order.includes(path))
    ]
    const seen: string[] = []

    return orderedPaths.flatMap((path) => {
      if (seen.includes(path)) return []
      seen.push(path)
      const mailbox = byPath.get(path)
      return mailbox ? [mailbox] : []
    })
  })

  function mailboxVisible(path: string) {
    return !mailboxPreferences.hidden.includes(path)
  }

  function setMailboxPreferenceOrder(paths: string[]) {
    form.mailboxPreferences = {
      ...mailboxPreferences,
      order: paths
    }
    scheduleAutosave(0)
  }

  function moveMailboxPreference(path: string, direction: -1 | 1) {
    const paths = mailboxPreferenceRows.map((mailbox) => mailbox.path)
    const index = paths.indexOf(path)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= paths.length) return

    const next = [...paths]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    setMailboxPreferenceOrder(next)
  }

  function setMailboxVisible(path: string, visible: boolean) {
    const hidden = visible
      ? mailboxPreferences.hidden.filter((candidate) => candidate !== path)
      : [...mailboxPreferences.hidden, path].filter(
          (candidate, index, values) => values.indexOf(candidate) === index
        )

    form.mailboxPreferences = {
      ...mailboxPreferences,
      hidden
    }
    scheduleAutosave(0)
  }

  function resetMailboxPreferences() {
    form.mailboxPreferences = { order: [], hidden: [] }
    scheduleAutosave(0)
  }

  const filteredTranslationLanguages = $derived.by(() => {
    const query = form.translationTargetLanguage.trim().toLowerCase()
    if (!query) return TRANSLATION_LANGUAGE_SUGGESTIONS.slice(0, 12)

    const exact = TRANSLATION_LANGUAGE_SUGGESTIONS.filter(
      (language) => language.toLowerCase() === query
    )
    const startsWith = TRANSLATION_LANGUAGE_SUGGESTIONS.filter(
      (language) => language.toLowerCase() !== query && language.toLowerCase().startsWith(query)
    )
    const includes = TRANSLATION_LANGUAGE_SUGGESTIONS.filter(
      (language) =>
        language.toLowerCase() !== query &&
        !language.toLowerCase().startsWith(query) &&
        language.toLowerCase().includes(query)
    )
    const rest = TRANSLATION_LANGUAGE_SUGGESTIONS.filter(
      (language) => ![...exact, ...startsWith, ...includes].includes(language)
    )

    return [...exact, ...startsWith, ...includes, ...rest].slice(0, 12)
  })

  const canUseCustomTranslationLanguage = $derived.by(() => {
    const query = form.translationTargetLanguage.trim()
    if (!query) return false
    return !TRANSLATION_LANGUAGE_SUGGESTIONS.some(
      (language) => language.toLowerCase() === query.toLowerCase()
    )
  })

  function openTranslationLanguageSuggestions() {
    if (translationLanguageBlurTimer) {
      clearTimeout(translationLanguageBlurTimer)
      translationLanguageBlurTimer = null
    }

    showTranslationLanguageSuggestions = true
    translationLanguageHighlightIndex = -1
  }

  function closeTranslationLanguageSuggestions() {
    showTranslationLanguageSuggestions = false
    translationLanguageHighlightIndex = -1
  }

  function selectTranslationLanguage(value: string) {
    form.translationTargetLanguage = value
    closeTranslationLanguageSuggestions()
  }

  function onTranslationLanguageInput() {
    openTranslationLanguageSuggestions()
  }

  function onTranslationLanguageKeydown(event: KeyboardEvent) {
    const suggestionCount =
      filteredTranslationLanguages.length + (canUseCustomTranslationLanguage ? 1 : 0)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!showTranslationLanguageSuggestions) {
        openTranslationLanguageSuggestions()
        return
      }
      translationLanguageHighlightIndex = Math.min(
        translationLanguageHighlightIndex + 1,
        suggestionCount - 1
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      translationLanguageHighlightIndex = Math.max(translationLanguageHighlightIndex - 1, -1)
      return
    }

    if (event.key === 'Enter') {
      if (!showTranslationLanguageSuggestions) return
      event.preventDefault()

      if (
        translationLanguageHighlightIndex >= 0 &&
        translationLanguageHighlightIndex < filteredTranslationLanguages.length
      ) {
        selectTranslationLanguage(filteredTranslationLanguages[translationLanguageHighlightIndex])
        return
      }

      if (
        canUseCustomTranslationLanguage &&
        translationLanguageHighlightIndex === filteredTranslationLanguages.length
      ) {
        selectTranslationLanguage(form.translationTargetLanguage.trim())
        return
      }

      closeTranslationLanguageSuggestions()
      return
    }

    if (event.key === 'Escape') {
      closeTranslationLanguageSuggestions()
    }
  }

  function onTranslationLanguageBlur() {
    translationLanguageBlurTimer = setTimeout(() => {
      closeTranslationLanguageSuggestions()
      translationLanguageBlurTimer = null
    }, 150)
  }

  async function save(
    options: { manual?: boolean; invalidate?: boolean; clearSecrets?: boolean } = {}
  ) {
    const snapshot = settingsSnapshot()
    saving = true
    if (options.manual) saveSuccess = false
    else autosaveStatus = 'saving'
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imap: imapPrimaryUsesLegacyFields ? imap : undefined,
          imapServers: imapServerPayload(),
          smtp: smtpPrimaryUsesLegacyFields ? smtp : undefined,
          smtpServers: smtpServerPayload(),
          oidc,
          signature: defaultSignatureHtml(),
          signatureProfiles,
          simplifiedView,
          threadModeOnPageLoad,
          compactMode: density !== 'comfortable',
          themePreference,
          density,
          translationTargetLanguage,
          remoteContent: {
            blockRemoteContent,
            allowedSenders: normalizeAllowedSenders(remoteContentAllowedSenders)
          },
          mailboxPreferences,
          quietHours
        })
      })
      if (!res.ok) {
        const message = await readErrorMessage(res, 'Failed to save settings.')
        if (options.manual) errorDialogMessage = message
        else autosaveStatus = 'error'
        return
      }

      lastSavedSettingsSnapshot = snapshot
      invalidateSignatureCache()
      if (options.manual) saveSuccess = true
      else autosaveStatus = 'saved'
      if (options.clearSecrets) {
        // Clear passwords after manual save so they show as bullets again.
        imap.password = ''
        for (const server of imapServers) server.password = ''
        smtp.password = ''
        for (const server of smtpServers) server.password = ''
        oidc.clientSecret = ''
        lastSavedSettingsSnapshot = settingsSnapshot()
      }
      if (options.invalidate || selectedSettingsSection === 'mailboxes') await invalidateAll()
    } catch (err) {
      if (options.manual)
        errorDialogMessage = errorMessageFromUnknown(err, 'Failed to save settings.')
      else autosaveStatus = 'error'
    } finally {
      saving = false
      if (!options.manual && settingsSnapshot() !== lastSavedSettingsSnapshot) {
        scheduleAutosave()
      }
    }
  }

  function scheduleAutosave(delayMs = 1000) {
    if (!autosaveReady) return
    const snapshot = settingsSnapshot()
    if (snapshot === lastSavedSettingsSnapshot) return

    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      void save()
    }, delayMs)
  }

  function defaultSignatureHtml() {
    return (
      signatureProfiles.find((signature) => signature.isDefault)?.html ??
      signatureProfiles[0]?.html ??
      ''
    )
  }

  function addSignatureProfile() {
    const isDefault = signatureProfiles.length === 0
    form.signatureProfiles = [
      ...signatureProfiles,
      { name: `Signature ${signatureProfiles.length + 1}`, html: '', isDefault }
    ]
    scheduleAutosave()
  }

  function removeSignatureProfile(index: number) {
    const next = signatureProfiles.filter((_signature, signatureIndex) => signatureIndex !== index)
    if (next.length > 0 && !next.some((signature) => signature.isDefault)) {
      next[0].isDefault = true
    }
    form.signatureProfiles = next
    scheduleAutosave()
  }

  function setDefaultSignature(index: number) {
    form.signatureProfiles = signatureProfiles.map((signature, signatureIndex) => ({
      ...signature,
      isDefault: signatureIndex === index
    }))
    scheduleAutosave()
  }

  function autosaveToggleChange() {
    setTimeout(() => scheduleAutosave(0), 0)
  }

  $effect(() => {
    settingsSnapshot()
    scheduleAutosave()
  })

  async function testImap() {
    testingImap = true
    imapTestResult = null
    try {
      const res = await fetch('/api/settings/test-imap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imap })
      })

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'IMAP connection failed.'))
      }

      const data = await res.json()
      imapTestResult = data.message ?? 'Connected successfully'
    } catch (err) {
      errorDialogMessage = errorMessageFromUnknown(err, 'IMAP connection failed.')
    } finally {
      testingImap = false
    }
  }

  async function testSmtp() {
    testingSmtp = true
    smtpTestResult = null
    try {
      const res = await fetch('/api/settings/test-smtp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ smtp })
      })

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, 'SMTP connection failed.'))
      }

      const data = await res.json()
      smtpTestResult = data.message ?? 'Connected successfully'
    } catch (err) {
      errorDialogMessage = errorMessageFromUnknown(err, 'SMTP connection failed.')
    } finally {
      testingSmtp = false
    }
  }
</script>

<div class="h-full min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-10">
  <div class="mx-auto max-w-6xl space-y-8">
    <div>
      <h1 class="text-xl font-semibold text-white">Settings</h1>
      <p class="mt-1 text-sm text-zinc-400">
        Values set here take priority over environment variables.
      </p>
      <p
        class="mt-3 rounded-lg border px-3 py-2 text-sm {data.config.secretStorage.configured
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-200'}"
      >
        {data.config.secretStorage.text}
      </p>
    </div>

    <div class="gap-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <nav
        aria-label="Settings sections"
        class="sticky top-0 z-20 -mx-4 mb-8 cursor-grab overflow-x-auto border-y border-white/8 bg-[#0d0d10]/95 px-4 py-2 select-none active:cursor-grabbing sm:-mx-6 sm:px-6 lg:top-6 lg:mx-0 lg:mb-0 lg:cursor-default lg:overflow-visible lg:rounded-2xl lg:border lg:bg-white/[0.03] lg:p-2 lg:active:cursor-default"
      >
        <div class="flex w-max gap-1 lg:w-auto lg:flex-col">
          {#each settingsSections as section (section.id)}
            <a
              href={resolve(`/settings/${section.id}`)}
              class={[
                'shrink-0 rounded-xl px-3 py-2 text-sm transition lg:w-full',
                selectedSettingsSection === section.id
                  ? 'bg-blue-600 font-medium text-white'
                  : 'text-zinc-400 hover:bg-white/6 hover:text-zinc-100'
              ]}
            >
              {section.label}
            </a>
          {/each}
        </div>
      </nav>

      <div class="max-w-3xl min-w-0 space-y-10 [&>div.border-t]:hidden">
        <!-- IMAP -->
        <section class={settingsSectionClass('imap')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
              IMAP — Incoming Mail
            </h2>
            {#if data.config.imap.source === 'db'}
              <span
                class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400"
                >from DB</span
              >
            {:else if data.config.imap.host}
              <span
                class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400"
                >from env</span
              >
            {/if}
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="col-span-2 sm:col-span-1">
              <label class="mb-1 block text-xs text-zinc-400" for="imap-host">Host</label>
              <input
                id="imap-host"
                type="text"
                placeholder={data.config.imap.source === 'env'
                  ? data.config.imap.host || 'e.g. imap.gmail.com'
                  : 'e.g. imap.gmail.com'}
                bind:value={imap.host}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="imap-port">Port</label>
              <input
                id="imap-port"
                type="number"
                min="1"
                max="65535"
                bind:value={imap.port}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="imap-user"
                >Username / Email</label
              >
              <input
                id="imap-user"
                type="text"
                autocomplete="username"
                placeholder="you@example.com"
                bind:value={imap.user}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="imap-password">Password</label>
              <input
                id="imap-password"
                type="password"
                autocomplete="current-password"
                placeholder={data.config.imap.password ? '(unchanged)' : 'Enter password'}
                bind:value={imap.password}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="imap-mailbox"
                >Default Mailbox</label
              >
              <input
                id="imap-mailbox"
                type="text"
                placeholder="INBOX"
                bind:value={imap.mailbox}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="imap-poll"
                >Poll interval (seconds)</label
              >
              <input
                id="imap-poll"
                type="number"
                min="5"
                bind:value={imap.pollSeconds}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2 flex items-center gap-2">
              <label class="relative inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  bind:checked={imap.secure}
                  onchange={autosaveToggleChange}
                  class="peer sr-only"
                />
                <div
                  class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                ></div>
                <span class="text-sm text-zinc-300">TLS / SSL</span>
              </label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onclick={testImap}
              disabled={testingImap}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              {testingImap ? 'Testing…' : 'Test connection'}
            </button>
            {#if imapTestResult}
              <span class="text-sm text-emerald-400">
                {imapTestResult}
              </span>
            {/if}
          </div>

          <div class="space-y-3 rounded-xl border border-white/8 bg-white/3 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-medium text-zinc-200">Secondary IMAP servers</h3>
                <p class="mt-1 text-xs text-zinc-500">
                  Additional inboxes sync alongside the primary server. Enter a password when adding
                  or changing a server.
                </p>
              </div>
              <button
                type="button"
                onclick={addImapServer}
                class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10"
              >
                <Plus size={14} /> Add IMAP
              </button>
            </div>

            {#if imapServers.length === 0}
              <div
                class="rounded-lg border border-dashed border-white/10 bg-black/10 p-3 text-sm text-zinc-500"
              >
                No secondary IMAP servers configured.
              </div>
            {:else}
              <div class="space-y-3">
                {#each imapServers as server, index (server.formKey)}
                  <div class="rounded-lg border border-white/8 bg-black/10 p-3">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-zinc-200">
                          {server.name || `Server ${index + 2}`}
                        </p>
                        {#if server.source === 'env'}
                          <p class="text-xs text-zinc-500">Loaded from env until saved here.</p>
                        {/if}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${server.name || 'IMAP server'}`}
                        onclick={() => removeImapServer(index)}
                        class="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-rose-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-name-${index}`}>Name</label
                        >
                        <input
                          id={`imap-server-name-${index}`}
                          type="text"
                          bind:value={server.name}
                          placeholder="Work"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-id-${index}`}>ID</label
                        >
                        <input
                          id={`imap-server-id-${index}`}
                          type="text"
                          bind:value={server.id}
                          placeholder="work"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-host-${index}`}>Host</label
                        >
                        <input
                          id={`imap-server-host-${index}`}
                          type="text"
                          bind:value={server.host}
                          placeholder="imap.example.com"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-port-${index}`}>Port</label
                        >
                        <input
                          id={`imap-server-port-${index}`}
                          type="number"
                          min="1"
                          max="65535"
                          bind:value={server.port}
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-user-${index}`}>Username / Email</label
                        >
                        <input
                          id={`imap-server-user-${index}`}
                          type="text"
                          autocomplete="username"
                          bind:value={server.user}
                          placeholder="you@example.com"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-password-${index}`}>Password</label
                        >
                        <input
                          id={`imap-server-password-${index}`}
                          type="password"
                          autocomplete="current-password"
                          bind:value={server.password}
                          placeholder={data.config.imapServers[index + 1]?.password
                            ? '(unchanged)'
                            : 'Enter password'}
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-mailbox-${index}`}>Default mailbox</label
                        >
                        <input
                          id={`imap-server-mailbox-${index}`}
                          type="text"
                          bind:value={server.mailbox}
                          placeholder="INBOX"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`imap-server-poll-${index}`}>Poll interval</label
                        >
                        <input
                          id={`imap-server-poll-${index}`}
                          type="number"
                          min="5"
                          bind:value={server.pollSeconds}
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label class="relative inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            bind:checked={server.secure}
                            onchange={autosaveToggleChange}
                            class="peer sr-only"
                          />
                          <div
                            class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                          ></div>
                          <span class="text-sm text-zinc-300">TLS / SSL</span>
                        </label>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- SMTP -->
        <section class={settingsSectionClass('smtp')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
              SMTP — Outgoing Mail
            </h2>
            {#if data.config.smtp.source === 'db'}
              <span
                class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400"
                >from DB</span
              >
            {:else if data.config.smtp.host}
              <span
                class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400"
                >from env</span
              >
            {/if}
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="col-span-2 sm:col-span-1">
              <label class="mb-1 block text-xs text-zinc-400" for="smtp-host">Host</label>
              <input
                id="smtp-host"
                type="text"
                placeholder="e.g. smtp.gmail.com"
                bind:value={smtp.host}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="smtp-port">Port</label>
              <input
                id="smtp-port"
                type="number"
                min="1"
                max="65535"
                bind:value={smtp.port}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="smtp-user"
                >Username / Email</label
              >
              <input
                id="smtp-user"
                type="text"
                autocomplete="username"
                placeholder="you@example.com"
                bind:value={smtp.user}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="smtp-password">Password</label>
              <input
                id="smtp-password"
                type="password"
                autocomplete="current-password"
                placeholder={data.config.smtp.password ? '(unchanged)' : 'Enter password'}
                bind:value={smtp.password}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2">
              <label class="mb-1 block text-xs text-zinc-400" for="smtp-from"
                >From address (optional)</label
              >
              <input
                id="smtp-from"
                type="text"
                placeholder="Defaults to username if empty"
                bind:value={smtp.from}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div class="col-span-2 sm:col-span-1">
              <label class="mb-1 block text-xs text-zinc-400" for="smtp-undo-send"
                >Undo send delay</label
              >
              <CustomSelect
                id="smtp-undo-send"
                value={smtp.undoSendSeconds}
                options={undoSendOptions}
                onchange={(value) => (smtp.undoSendSeconds = Number(value))}
                ariaLabel="Undo send delay"
                class="w-full"
                buttonClass="px-3 py-2 text-sm"
              />
              <p class="mt-1 text-xs text-zinc-500">
                Immediate sends wait this long before the SMTP worker can deliver them. Send later
                is unchanged.
              </p>
            </div>
            <div class="col-span-2 flex items-center gap-2">
              <label class="relative inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  bind:checked={smtp.secure}
                  onchange={autosaveToggleChange}
                  class="peer sr-only"
                />
                <div
                  class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                ></div>
                <span class="text-sm text-zinc-300">TLS / SSL</span>
              </label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onclick={testSmtp}
              disabled={testingSmtp}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              {testingSmtp ? 'Testing…' : 'Test connection'}
            </button>
            {#if smtpTestResult}
              <span class="text-sm text-emerald-400">
                {smtpTestResult}
              </span>
            {/if}
          </div>

          <div class="space-y-3 rounded-xl border border-white/8 bg-white/3 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-medium text-zinc-200">Secondary SMTP servers</h3>
                <p class="mt-1 text-xs text-zinc-500">
                  Store alternate outgoing servers. Current sends still use the first available SMTP
                  server.
                </p>
              </div>
              <button
                type="button"
                onclick={addSmtpServer}
                class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10"
              >
                <Plus size={14} /> Add SMTP
              </button>
            </div>

            {#if smtpServers.length === 0}
              <div
                class="rounded-lg border border-dashed border-white/10 bg-black/10 p-3 text-sm text-zinc-500"
              >
                No secondary SMTP servers configured.
              </div>
            {:else}
              <div class="space-y-3">
                {#each smtpServers as server, index (server.formKey)}
                  <div class="rounded-lg border border-white/8 bg-black/10 p-3">
                    <div class="mb-3 flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-zinc-200">
                          {server.name || `Server ${index + 2}`}
                        </p>
                        {#if server.source === 'env'}
                          <p class="text-xs text-zinc-500">Loaded from env until saved here.</p>
                        {/if}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${server.name || 'SMTP server'}`}
                        onclick={() => removeSmtpServer(index)}
                        class="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-rose-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-name-${index}`}>Name</label
                        >
                        <input
                          id={`smtp-server-name-${index}`}
                          type="text"
                          bind:value={server.name}
                          placeholder="Work"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-id-${index}`}>ID</label
                        >
                        <input
                          id={`smtp-server-id-${index}`}
                          type="text"
                          bind:value={server.id}
                          placeholder="work"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-host-${index}`}>Host</label
                        >
                        <input
                          id={`smtp-server-host-${index}`}
                          type="text"
                          bind:value={server.host}
                          placeholder="smtp.example.com"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-port-${index}`}>Port</label
                        >
                        <input
                          id={`smtp-server-port-${index}`}
                          type="number"
                          min="1"
                          max="65535"
                          bind:value={server.port}
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-user-${index}`}>Username / Email</label
                        >
                        <input
                          id={`smtp-server-user-${index}`}
                          type="text"
                          autocomplete="username"
                          bind:value={server.user}
                          placeholder="you@example.com"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-password-${index}`}>Password</label
                        >
                        <input
                          id={`smtp-server-password-${index}`}
                          type="password"
                          autocomplete="current-password"
                          bind:value={server.password}
                          placeholder={data.config.smtpServers[index + 1]?.password
                            ? '(unchanged)'
                            : 'Enter password'}
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label
                          class="mb-1 block text-xs text-zinc-400"
                          for={`smtp-server-from-${index}`}>From address</label
                        >
                        <input
                          id={`smtp-server-from-${index}`}
                          type="text"
                          bind:value={server.from}
                          placeholder="Defaults to username if empty"
                          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      <div class="sm:col-span-2">
                        <label class="relative inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            bind:checked={server.secure}
                            onchange={autosaveToggleChange}
                            class="peer sr-only"
                          />
                          <div
                            class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                          ></div>
                          <span class="text-sm text-zinc-300">TLS / SSL</span>
                        </label>
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Mailboxes -->
        <section class={settingsSectionClass('mailboxes')}>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
                Mailboxes
              </h2>
              <p class="mt-1 text-sm text-zinc-500">
                Choose which folders appear in the sidebar and adjust their order.
              </p>
            </div>
            <button
              type="button"
              onclick={resetMailboxPreferences}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10"
            >
              Reset order
            </button>
          </div>

          {#if mailboxPreferenceRows.length === 0}
            <div
              class="rounded-lg border border-dashed border-white/10 bg-white/3 p-4 text-sm text-zinc-500"
            >
              Mailboxes will appear here after the first sync.
            </div>
          {:else}
            <div class="overflow-hidden rounded-xl border border-white/8 bg-white/3">
              {#each mailboxPreferenceRows as mailbox, index (mailbox.path)}
                <div
                  class="flex flex-col gap-3 border-b border-white/6 p-4 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <label class="flex min-w-0 flex-1 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={mailboxVisible(mailbox.path)}
                      onchange={(event) =>
                        setMailboxVisible(mailbox.path, event.currentTarget.checked)}
                      class="mt-1 h-4 w-4 rounded border-white/20 bg-white/5 text-blue-600 focus:ring-blue-500"
                    />
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-zinc-200">
                        {mailbox.name || mailbox.path}
                      </span>
                      <span class="mt-0.5 block truncate font-mono text-xs text-zinc-600">
                        {mailbox.path}
                      </span>
                    </span>
                  </label>

                  <div class="flex shrink-0 gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={index === 0}
                      onclick={() => moveMailboxPreference(mailbox.path, -1)}
                      class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      disabled={index === mailboxPreferenceRows.length - 1}
                      onclick={() => moveMailboxPreference(mailbox.path, 1)}
                      class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Down
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>

        <div class="border-t border-white/8"></div>

        <!-- OIDC -->
        <section class={settingsSectionClass('oidc')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
              OIDC — Authentication
            </h2>
            {#if data.config.oidc.source === 'db'}
              <span
                class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400"
                >from DB</span
              >
            {:else if data.config.oidc.discoveryUrl || data.config.oidc.clientId}
              <span
                class="rounded-full bg-zinc-700/60 px-2 py-0.5 text-xs font-medium text-zinc-400"
                >from env</span
              >
            {/if}
          </div>

          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidc-discovery"
                >Discovery URL</label
              >
              <input
                id="oidc-discovery"
                type="url"
                placeholder="https://auth.example.com/…/.well-known/openid-configuration"
                bind:value={oidc.discoveryUrl}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidc-client-id">Client ID</label>
              <input
                id="oidc-client-id"
                type="text"
                placeholder="your-client-id"
                bind:value={oidc.clientId}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400" for="oidc-client-secret"
                >Client Secret</label
              >
              <input
                id="oidc-client-secret"
                type="password"
                autocomplete="new-password"
                placeholder={data.config.oidc.clientSecret ? '(unchanged)' : 'Enter client secret'}
                bind:value={oidc.clientSecret}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <p class="text-xs text-zinc-500">
              Redirect URI to register with your provider: <span class="font-mono text-zinc-400"
                >{data.origin}/api/auth/oauth2/callback/oidc</span
              >
            </p>
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Security -->
        <section class={settingsSectionClass('sessions')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
                Security
              </h2>
              <p class="mt-1 text-sm text-zinc-500">Review active sessions and sign out devices.</p>
            </div>
            <button
              type="button"
              onclick={() => void loadSessions()}
              disabled={loadingSessions}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              {loadingSessions ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div class="space-y-3">
            {#if loadingSessions && sessions.length === 0}
              <p class="text-sm text-zinc-600">Loading active sessions...</p>
            {:else if sessions.length === 0}
              <p class="text-sm text-zinc-600">No active sessions found.</p>
            {:else}
              {#each sessions as session (session.id)}
                <div class="rounded-lg border border-white/8 bg-white/3 p-4">
                  <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0 space-y-2">
                      <div class="flex flex-wrap items-center gap-2">
                        <p class="text-sm font-medium text-zinc-200">{session.deviceLabel}</p>
                        {#if session.isCurrent}
                          <span
                            class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300"
                          >
                            Current session
                          </span>
                        {/if}
                      </div>
                      <dl class="grid grid-cols-1 gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                        <div>
                          <dt class="inline text-zinc-600">Last active:</dt>
                          <dd class="inline text-zinc-400">
                            {formatSessionDate(session.updatedAt)}
                          </dd>
                        </div>
                        <div>
                          <dt class="inline text-zinc-600">Expires:</dt>
                          <dd class="inline text-zinc-400">
                            {formatSessionDate(session.expiresAt)}
                          </dd>
                        </div>
                        <div>
                          <dt class="inline text-zinc-600">Created:</dt>
                          <dd class="inline text-zinc-400">
                            {formatSessionDate(session.createdAt)}
                          </dd>
                        </div>
                        <div>
                          <dt class="inline text-zinc-600">IP address:</dt>
                          <dd class="inline text-zinc-400">{session.ipAddress ?? 'Unknown'}</dd>
                        </div>
                      </dl>
                      {#if session.userAgent}
                        <p class="max-w-full truncate font-mono text-xs text-zinc-600">
                          {session.userAgent}
                        </p>
                      {/if}
                    </div>

                    <button
                      type="button"
                      onclick={() => void revokeSession(session)}
                      disabled={revokingSessionId === session.id}
                      class={[
                        'shrink-0 rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-50',
                        session.isCurrent
                          ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                          : 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                      ].join(' ')}
                    >
                      {revokingSessionId === session.id
                        ? 'Revoking...'
                        : session.isCurrent
                          ? 'Sign out here'
                          : 'Revoke'}
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Interface -->
        <section class={settingsSectionClass('interface')}>
          <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Interface</h2>
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <label class="block" for="theme-preference">
              <p class="text-sm font-medium text-zinc-200">Theme</p>
              <p class="mt-1 text-sm text-zinc-500">
                Choose a light or dark interface, or follow your system setting.
              </p>
              <CustomSelect
                id="theme-preference"
                value={themePreference}
                options={themeOptions}
                onchange={(value) => {
                  form.themePreference = value as ThemePreference
                  applyThemePreference(form.themePreference)
                  autosaveToggleChange()
                }}
                ariaLabel="Theme"
                class="mt-3 w-full sm:max-w-xs"
                buttonClass="px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <label class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-sm font-medium text-zinc-200">Use thread mode on page load</p>
                <p class="mt-1 text-sm text-zinc-500">
                  Open mailbox root pages grouped by conversation. You can still toggle this per
                  mailbox session.
                </p>
              </div>

              <span class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  bind:checked={threadModeOnPageLoad}
                  onchange={autosaveToggleChange}
                  class="peer sr-only"
                />
                <span
                  class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                ></span>
              </span>
            </label>
          </div>
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <label class="block">
              <p class="text-sm font-medium text-zinc-200">Mail translation target language</p>
              <p class="mt-1 text-sm text-zinc-500">
                Used by the Translate action on email detail pages.
              </p>
              <div class="relative mt-3">
                <input
                  type="text"
                  placeholder="Korean"
                  bind:value={translationTargetLanguage}
                  onfocus={openTranslationLanguageSuggestions}
                  oninput={onTranslationLanguageInput}
                  onkeydown={onTranslationLanguageKeydown}
                  onblur={onTranslationLanguageBlur}
                  autocomplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showTranslationLanguageSuggestions}
                  aria-controls={translationLanguageListboxId}
                  aria-haspopup="listbox"
                  class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                />

                {#if showTranslationLanguageSuggestions && (filteredTranslationLanguages.length > 0 || canUseCustomTranslationLanguage)}
                  <div
                    id={translationLanguageListboxId}
                    role="listbox"
                    class="absolute top-full left-0 z-20 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-[#1a1b20] shadow-2xl"
                  >
                    {#each filteredTranslationLanguages as language, index (`${language}-${index}`)}
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === translationLanguageHighlightIndex}
                        class={[
                          'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition',
                          index === translationLanguageHighlightIndex
                            ? 'bg-blue-600/20 text-white'
                            : 'text-zinc-300 hover:bg-white/5'
                        ].join(' ')}
                        onmousedown={() => selectTranslationLanguage(language)}
                      >
                        <span>{language}</span>
                        <span
                          class="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] tracking-wide text-zinc-500 uppercase"
                        >
                          Suggested
                        </span>
                      </button>
                    {/each}

                    {#if canUseCustomTranslationLanguage}
                      <button
                        type="button"
                        role="option"
                        aria-selected={translationLanguageHighlightIndex ===
                          filteredTranslationLanguages.length}
                        class={[
                          'flex w-full items-center justify-between border-t border-white/8 px-3 py-2 text-left text-sm transition',
                          translationLanguageHighlightIndex === filteredTranslationLanguages.length
                            ? 'bg-blue-600/20 text-white'
                            : 'text-zinc-300 hover:bg-white/5'
                        ].join(' ')}
                        onmousedown={() =>
                          selectTranslationLanguage(form.translationTargetLanguage.trim())}
                      >
                        <span class="truncate"
                          >Use custom value: {form.translationTargetLanguage.trim()}</span
                        >
                        <span
                          class="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] tracking-wide text-emerald-300 uppercase"
                        >
                          Custom
                        </span>
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            </label>
          </div>
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <label class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-sm font-medium text-zinc-200">
                  Use simplified mailbox view on page load
                </p>
                <p class="mt-1 text-sm text-zinc-500">
                  Open mailbox root pages in the swipeable card view by default.
                </p>
              </div>

              <span class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  bind:checked={simplifiedView}
                  onchange={autosaveToggleChange}
                  class="peer sr-only"
                />
                <span
                  class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                ></span>
              </span>
            </label>
          </div>
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <div class="flex flex-col gap-4">
              <div>
                <p class="text-sm font-medium text-zinc-200">Display density</p>
                <p class="mt-1 text-sm text-zinc-500">
                  Adjust message list, sidebar, and reading pane spacing.
                </p>
              </div>

              <div class="grid gap-2 sm:grid-cols-3">
                {#each densityOptions as option (option.value)}
                  <label
                    class={[
                      'cursor-pointer rounded-lg border p-3 transition',
                      density === option.value
                        ? 'border-blue-400/50 bg-blue-500/10'
                        : 'border-white/8 bg-black/10 hover:border-white/20'
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="density"
                      value={option.value}
                      bind:group={density}
                      onchange={autosaveToggleChange}
                      class="sr-only"
                    />
                    <span class="block text-sm font-medium text-zinc-200">{option.label}</span>
                    <span class="mt-1 block text-xs leading-5 text-zinc-500"
                      >{option.description}</span
                    >
                  </label>
                {/each}
              </div>
            </div>
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Security -->
        <!-- Privacy -->
        <section class={settingsSectionClass('privacy')}>
          <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Privacy</h2>
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <label class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-sm font-medium text-zinc-200">Block remote email content</p>
                <p class="mt-1 text-sm text-zinc-500">
                  Prevent external images and tracking resources from loading until you allow them.
                </p>
              </div>

              <span class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  bind:checked={blockRemoteContent}
                  onchange={autosaveToggleChange}
                  class="peer sr-only"
                />
                <span
                  class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                ></span>
              </span>
            </label>
          </div>
          <div class="space-y-2 rounded-lg border border-white/8 bg-white/3 p-4">
            <label
              class="block text-sm font-medium text-zinc-200"
              for="remote-content-allowed-senders"
            >
              Trusted remote content senders
            </label>
            <p class="text-sm text-zinc-500">
              One email address per line. Remote content is always shown for these senders.
            </p>
            <textarea
              id="remote-content-allowed-senders"
              rows="4"
              placeholder="sender@example.com"
              bind:value={remoteContentAllowedSenders}
              class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
            ></textarea>
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Signature -->
        <section class={settingsSectionClass('signatures')}>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
                Signatures
              </h2>
              <p class="mt-1 text-sm text-zinc-500">
                Create reusable HTML signatures and choose the default for new messages.
              </p>
            </div>
            <button
              type="button"
              onclick={addSignatureProfile}
              class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
            >
              <Plus size={14} />
              Add signature
            </button>
          </div>

          {#if signatureProfiles.length === 0}
            <div
              class="rounded-lg border border-dashed border-white/10 bg-white/3 p-4 text-sm text-zinc-500"
            >
              No signatures configured. New messages will open without a signature.
            </div>
          {:else}
            <div class="space-y-3">
              {#each signatureProfiles as signature, index (signature.id ?? `${signature.name}-${index}`)}
                <div class="rounded-lg border border-white/8 bg-white/3 p-4">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label class="min-w-0 flex-1">
                      <span class="block text-xs text-zinc-400">Name</span>
                      <input
                        type="text"
                        bind:value={signature.name}
                        placeholder="Work"
                        class="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <div class="flex items-center gap-2">
                      <label class="inline-flex items-center gap-2 text-xs text-zinc-400">
                        <input
                          type="radio"
                          name="default-signature"
                          checked={signature.isDefault}
                          onchange={() => setDefaultSignature(index)}
                          class="accent-blue-500"
                        />
                        Default
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove ${signature.name || 'signature'}`}
                        onclick={() => removeSignatureProfile(index)}
                        class="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-rose-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <label class="mt-3 block">
                    <span class="block text-xs text-zinc-400">Signature HTML</span>
                    <textarea
                      rows="4"
                      placeholder="--&#10;Your Name"
                      bind:value={signature.html}
                      class="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                    ></textarea>
                  </label>
                </div>
              {/each}
            </div>
            <p class="text-xs text-zinc-600">
              Accepts plain text or HTML. The default signature is also kept in the legacy signature
              setting for compatibility.
            </p>
          {/if}
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Message templates -->
        <section class={settingsSectionClass('templates')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
                Message Templates
              </h2>
              <p class="mt-1 text-sm text-zinc-500">
                Insert reusable full messages or snippets from the composer.
              </p>
            </div>
            <button
              type="button"
              onclick={() => (showAddTemplate = !showAddTemplate)}
              class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              <Plus size={12} /> Add template
            </button>
          </div>

          {#if showAddTemplate}
            <div class="space-y-3 rounded-lg border border-white/10 bg-white/4 p-4">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs text-zinc-400" for="template-name">Name</label>
                  <input
                    id="template-name"
                    type="text"
                    bind:value={newTemplate.name}
                    placeholder="Follow-up"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-zinc-400" for="template-subject">
                    Subject (optional)
                  </label>
                  <input
                    id="template-subject"
                    type="text"
                    bind:value={newTemplate.subject}
                    placeholder="Following up"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <label class="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" bind:checked={newTemplate.isSnippet} class="rounded" />
                Treat as snippet
              </label>
              <div>
                <label class="mb-1 block text-xs text-zinc-400" for="template-html">
                  Body HTML
                </label>
                <textarea
                  id="template-html"
                  rows="5"
                  bind:value={newTemplate.html}
                  placeholder="<p>Hi,</p><p>Thanks for reaching out.</p>"
                  class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                ></textarea>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => void addTemplate()}
                  disabled={savingTemplate || !newTemplate.name.trim() || !newTemplate.html.trim()}
                  class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {savingTemplate ? 'Saving...' : 'Save template'}
                </button>
                <button
                  type="button"
                  onclick={() => {
                    resetNewTemplate()
                    showAddTemplate = false
                  }}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}

          {#if templates.length === 0 && !showAddTemplate}
            <p class="text-sm text-zinc-600">No message templates configured.</p>
          {/if}

          {#each templates as template (template.id)}
            <div class="rounded-lg border border-white/8 bg-white/3 p-4">
              {#if editingTemplateId === template.id}
                <div class="space-y-3">
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      aria-label="Template name"
                      bind:value={template.name}
                      class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      aria-label="Template subject"
                      bind:value={template.subject}
                      placeholder="Subject (optional)"
                      class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <label class="flex items-center gap-2 text-sm text-zinc-300">
                    <input type="checkbox" bind:checked={template.isSnippet} class="rounded" />
                    Treat as snippet
                  </label>
                  <textarea
                    rows="5"
                    aria-label="Template body HTML"
                    bind:value={template.html}
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-zinc-300 focus:border-blue-500 focus:outline-none"
                  ></textarea>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onclick={() => void updateTemplate(template)}
                      disabled={savingTemplate || !template.name.trim() || !template.html.trim()}
                      class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {savingTemplate ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onclick={() => {
                        editingTemplateId = null
                        void loadTemplates()
                      }}
                      class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              {:else}
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-sm font-medium text-zinc-200">{template.name}</p>
                      <span
                        class="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] tracking-wide text-zinc-500 uppercase"
                      >
                        {template.isSnippet ? 'Snippet' : 'Template'}
                      </span>
                    </div>
                    {#if template.subject}
                      <p class="mt-1 truncate text-sm text-zinc-500">Subject: {template.subject}</p>
                    {/if}
                    <p class="mt-2 line-clamp-2 font-mono text-xs break-all text-zinc-600">
                      {template.html}
                    </p>
                  </div>
                  <div class="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onclick={() => (editingTemplateId = template.id)}
                      class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${template.name}`}
                      onclick={() => void deleteTemplate(template.id)}
                      class="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-zinc-400 hover:bg-white/10 hover:text-rose-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Notifications -->
        <section class={settingsSectionClass('notifications')}>
          <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
            Push Notifications
          </h2>
          <p class="text-sm text-zinc-500">
            Receive push notifications for new mail. On iOS, the app must be added to the home
            screen first.
          </p>

          <!-- Subscription status -->
          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            {#if pushStatus === 'unsupported'}
              <p class="text-sm text-zinc-500">
                Push notifications are not supported in this browser.
              </p>
            {:else if pushStatus === 'denied'}
              <p class="text-sm text-amber-400">
                Notifications are blocked. Enable them in your browser or OS settings, then reload.
              </p>
            {:else if pushStatus === 'subscribed'}
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-sm text-emerald-400">Notifications are enabled on this device.</p>
                <button
                  type="button"
                  onclick={() => void testPush()}
                  disabled={testingPush}
                  class="shrink-0 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
                >
                  {testingPush ? 'Sending…' : 'Send test'}
                </button>
              </div>
            {:else}
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-sm font-medium text-zinc-200">Enable notifications</p>
                  <p class="mt-0.5 text-xs text-zinc-500">Get notified when new mail arrives.</p>
                </div>
                <button
                  type="button"
                  onclick={() => void enablePushNotifications()}
                  disabled={subscribing}
                  class="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {subscribing ? 'Enabling…' : 'Enable notifications'}
                </button>
              </div>
            {/if}
          </div>

          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <div class="mb-3">
              <p class="text-sm font-medium text-zinc-200">Mailbox notification rules</p>
              <p class="mt-1 text-sm text-zinc-500">
                Choose which mailboxes can send push notifications when new mail syncs.
              </p>
            </div>

            {#if mailboxNotificationRules.length === 0}
              <p class="text-sm text-zinc-500">
                Mailbox rules will appear after mailboxes are loaded.
              </p>
            {:else}
              <div class="divide-y divide-white/8">
                {#each mailboxNotificationRules as rule (rule.mailbox)}
                  <label class="flex items-center justify-between gap-4 py-3">
                    <span class="min-w-0">
                      <span class="block truncate text-sm text-zinc-200">{rule.mailbox}</span>
                      {#if !rule.canNotify}
                        <span class="text-xs text-zinc-600"
                          >Sent and draft-like mailboxes never notify.</span
                        >
                      {/if}
                    </span>

                    <span class="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={rule.enabled && rule.canNotify}
                        disabled={!rule.canNotify}
                        onchange={(event) =>
                          void setMailboxNotifications(rule, event.currentTarget.checked)}
                        class="peer sr-only"
                      />
                      <span
                        class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 peer-disabled:opacity-40 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                      ></span>
                    </span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <label class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-sm font-medium text-zinc-200">Quiet hours</p>
                <p class="mt-1 text-sm text-zinc-500">
                  Suppress push notifications during a daily local-time window.
                </p>
              </div>

              <span class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  bind:checked={quietHours.enabled}
                  onchange={autosaveToggleChange}
                  class="peer sr-only"
                />
                <span
                  class="h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
                ></span>
              </span>
            </label>

            <div class="mt-4 grid gap-3 sm:grid-cols-3">
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Start</span>
                <input
                  type="time"
                  bind:value={quietHours.start}
                  disabled={!quietHours.enabled}
                  class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">End</span>
                <input
                  type="time"
                  bind:value={quietHours.end}
                  disabled={!quietHours.enabled}
                  class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-zinc-400">Timezone</span>
                <input
                  type="text"
                  placeholder="UTC"
                  bind:value={quietHours.timezone}
                  disabled={!quietHours.enabled}
                  class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </label>
            </div>
            <p class="mt-2 text-xs text-zinc-600">
              Use an IANA timezone such as America/New_York. Windows that cross midnight are
              supported.
            </p>
          </div>

          <p class="text-xs text-zinc-600">
            VAPID keys are required for push to work. Generate them once below.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onclick={() => void generateVapid()}
              disabled={notifStatus === 'generating'}
              class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              {notifStatus === 'generating' ? 'Generating…' : 'Generate VAPID keys'}
            </button>
            {#if notifStatus === 'done'}
              <span class="text-sm text-emerald-400">Keys generated. Reload to activate push.</span>
            {/if}
          </div>
          {#if notifPublicKey}
            <p class="font-mono text-xs break-all text-zinc-600">{notifPublicKey}</p>
          {/if}
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Cleanup Rules -->
        <section class={settingsSectionClass('cleanup')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
                Auto-Cleanup
              </h2>
              <p class="mt-1 text-sm text-zinc-500">
                Archive old mail automatically. Cleanup never deletes messages.
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                onclick={() => void runCleanupNow()}
                disabled={runningCleanup}
                class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
              >
                {runningCleanup ? 'Running...' : 'Run cleanup'}
              </button>
              <button
                type="button"
                onclick={() => (showAddCleanupRule = true)}
                class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
              >
                <Plus size={12} /> Add cleanup
              </button>
            </div>
          </div>

          {#if cleanupRunMessage}
            <p class="text-sm text-emerald-400">{cleanupRunMessage}</p>
          {/if}

          {#if cleanupRules.length === 0 && !showAddCleanupRule}
            <p class="text-sm text-zinc-600">No cleanup rules configured.</p>
          {/if}

          {#each cleanupRules as rule (rule.id)}
            <div
              class="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2 sm:flex-nowrap"
            >
              <div class="min-w-0 flex-1 basis-full sm:basis-auto">
                <p class="text-xs text-zinc-300">
                  <span class="text-zinc-500">Archive messages older than</span>
                  <span class="font-medium text-zinc-200">{rule.minAgeDays} days</span>
                  <span class="text-zinc-500">from</span>
                  <span class="font-mono text-zinc-200"
                    >{rule.mailbox || 'all regular mailboxes'}</span
                  >
                </p>
                {#if rule.lastRunAt}
                  <p class="mt-1 text-xs text-zinc-600">
                    Last run {new Date(rule.lastRunAt).toLocaleString()}
                  </p>
                {/if}
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onchange={() => void toggleCleanupRule(rule)}
                  class="peer sr-only"
                />
                <div
                  class="h-4 w-7 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-3"
                ></div>
              </label>
              <button
                type="button"
                onclick={() => void deleteCleanupRule(rule.id)}
                class="shrink-0 text-zinc-600 hover:text-rose-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          {/each}

          {#if showAddCleanupRule}
            <div class="space-y-3 rounded-lg border border-white/10 bg-white/3 p-4">
              <h3 class="text-xs font-medium text-zinc-400">New cleanup rule</h3>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs text-zinc-500" for="cleanup-age"
                    >Older than</label
                  >
                  <input
                    id="cleanup-age"
                    type="number"
                    min="7"
                    bind:value={newCleanupRule.minAgeDays}
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  />
                  <p class="mt-1 text-xs text-zinc-600">Minimum 7 days.</p>
                </div>
                <div>
                  <label class="mb-1 block text-xs text-zinc-500" for="cleanup-mailbox"
                    >Mailbox path</label
                  >
                  <input
                    id="cleanup-mailbox"
                    type="text"
                    bind:value={newCleanupRule.mailbox}
                    placeholder="Leave blank for all regular mailboxes"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => void addCleanupRule()}
                  class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                >
                  Add cleanup rule
                </button>
                <button
                  type="button"
                  onclick={() => void previewNewCleanupRule()}
                  disabled={previewingCleanup}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {previewingCleanup ? 'Previewing...' : 'Dry-run preview'}
                </button>
                <button
                  type="button"
                  onclick={() => (showAddCleanupRule = false)}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
              {#if cleanupPreview.length > 0}
                <div class="rounded-lg border border-white/8 bg-black/20 p-3">
                  <p class="mb-2 text-xs font-medium text-zinc-400">Dry-run preview</p>
                  <div class="space-y-2">
                    {#each cleanupPreview as match (match.id)}
                      <div class="text-xs text-zinc-400">
                        <span class="text-zinc-200">{match.subject || '(no subject)'}</span>
                        <span> from {match.from || 'unknown'} in {match.mailbox}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Sender Rules -->
        <section class={settingsSectionClass('senders')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
                Sender Rules
              </h2>
              <p class="mt-1 text-xs text-zinc-600">
                Blocked senders are moved to trash during sync. Allowlisted senders override blocks.
              </p>
            </div>
            <button
              type="button"
              onclick={() => (showAddSenderRule = !showAddSenderRule)}
              class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              <Plus size={12} /> Add sender
            </button>
          </div>

          {#if senderRules.length === 0 && !showAddSenderRule}
            <p class="text-sm text-zinc-600">No blocked or allowlisted senders configured.</p>
          {/if}

          {#each senderRules as rule (rule.id)}
            <div
              class="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2 sm:flex-nowrap"
            >
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium {rule.type === 'allow'
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : 'bg-rose-500/10 text-rose-300'}"
              >
                {rule.type === 'allow' ? 'Allow' : 'Block'}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-zinc-200">{rule.sender}</p>
                <p class="truncate text-xs text-zinc-600">{rule.normalizedSender}</p>
              </div>
              <button
                type="button"
                onclick={() => void deleteSenderRule(rule.id)}
                class="shrink-0 text-zinc-600 hover:text-rose-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          {/each}

          {#if showAddSenderRule}
            <div class="space-y-3 rounded-lg border border-white/10 bg-white/3 p-4">
              <h3 class="text-xs font-medium text-zinc-400">New sender rule</h3>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                <div>
                  <label class="mb-1 block text-xs text-zinc-500" for="new-sender-rule-type"
                    >Type</label
                  >
                  <CustomSelect
                    id="new-sender-rule-type"
                    value={newSenderRule.type}
                    options={senderRuleTypeOptions}
                    onchange={(value) => (newSenderRule.type = value as 'block' | 'allow')}
                    ariaLabel="Sender rule type"
                    class="w-full"
                    buttonClass="px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-zinc-500" for="new-sender-rule-sender"
                    >Sender</label
                  >
                  <input
                    id="new-sender-rule-sender"
                    type="text"
                    bind:value={newSenderRule.sender}
                    placeholder="newsletter@example.com"
                    class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => void addSenderRule()}
                  disabled={!newSenderRule.sender.trim()}
                  class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >Add sender</button
                >
                <button
                  type="button"
                  onclick={() => (showAddSenderRule = false)}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                  >Cancel</button
                >
              </div>
            </div>
          {/if}
        </section>

        <!-- Filters -->
        <section class={settingsSectionClass('filters')}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">Filters</h2>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                onclick={() => void exportFilters()}
                disabled={exportingFilters}
                class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
              >
                <Download size={12} />
                {exportingFilters ? 'Exporting...' : 'Export'}
              </button>
              <label
                class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
              >
                <Upload size={12} /> Import
                <input
                  type="file"
                  accept="application/json,.json"
                  class="sr-only"
                  onchange={(event) => void selectFilterImport(event)}
                />
              </label>
              <button
                type="button"
                onclick={() => void runFiltersNow()}
                disabled={runningFilters}
                class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
              >
                {runningFilters ? 'Running...' : 'Run now'}
              </button>
              <button
                type="button"
                onclick={() => (showAddFilter = !showAddFilter)}
                class="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
              >
                <Plus size={12} /> Add rule
              </button>
            </div>
          </div>

          {#if filterRunMessage}
            <p class="text-sm text-emerald-400">{filterRunMessage}</p>
          {/if}

          {#if filterImportMessage}
            <p class="text-sm text-emerald-400">{filterImportMessage}</p>
          {/if}

          {#if filterImportPreview}
            <div class="space-y-3 rounded-lg border border-white/10 bg-white/3 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="text-xs font-medium text-zinc-300">Import preview</h3>
                  <p class="mt-1 text-xs text-zinc-500">
                    {filterImportPreview.importableCount} rules ready, {filterImportPreview.duplicateCount}
                    duplicates, {filterImportPreview.issues.length} issues.
                  </p>
                </div>
                <label class="flex items-center gap-2 text-xs text-zinc-400">
                  Duplicates
                  <CustomSelect
                    value={importConflictStrategy}
                    options={importConflictOptions}
                    onchange={(value) => {
                      importConflictStrategy = value as 'skip' | 'duplicate'
                      void previewFilterImport()
                    }}
                    ariaLabel="Duplicate filter import strategy"
                    class="w-36"
                    buttonClass="px-2 py-1 text-xs"
                  />
                </label>
              </div>
              {#if filterImportPreview.issues.length > 0}
                <div class="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  {#each filterImportPreview.issues as issue, issueIndex (`${issue.index}-${issueIndex}`)}
                    <p class="text-xs text-amber-300">{issue.message}</p>
                  {/each}
                </div>
              {/if}
              {#if filterImportPreview.candidates.length > 0}
                <div
                  class="max-h-44 space-y-2 overflow-auto rounded-lg border border-white/8 bg-black/20 p-3"
                >
                  {#each filterImportPreview.candidates as candidate (candidate.index)}
                    <div class="text-xs text-zinc-400">
                      <span class="font-medium text-zinc-200">{candidate.rule.field}</span>
                      <span>{candidate.rule.operator}</span>
                      <span class="font-mono text-zinc-200">"{candidate.rule.value}"</span>
                      <span>→ {candidate.rule.action}</span>
                      {#if candidate.duplicate}
                        <span class="text-amber-300">duplicate</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={() => void applyFilterImport()}
                  disabled={importingFilters ||
                    !filterImportPreview.ok ||
                    filterImportPreview.importableCount === 0}
                  class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {importingFilters ? 'Importing...' : 'Import rules'}
                </button>
                <button
                  type="button"
                  onclick={() => {
                    filterImportPayload = null
                    filterImportPreview = null
                  }}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Cancel import
                </button>
              </div>
            </div>
          {/if}

          {#if filters.length === 0 && !showAddFilter}
            <p class="text-sm text-zinc-600">
              No filters configured. Filters auto-process incoming mail.
            </p>
          {/if}

          {#each filters as filter (filter.id)}
            <div
              class="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2 sm:flex-nowrap"
            >
              <GripVertical size={14} class="shrink-0 cursor-grab text-zinc-600" />
              <div class="min-w-0 flex-1 basis-full sm:basis-auto">
                <p class="text-xs text-zinc-300">
                  <span class="text-zinc-500">If</span>
                  <span class="font-medium text-zinc-200">{filterSummary(filter)}</span>
                  <span class="text-zinc-500">→</span>
                  <span class="font-medium text-zinc-200">
                    {filterActionDescription(filter)}
                  </span>
                </p>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  onchange={() => void toggleFilter(filter)}
                  class="peer sr-only"
                />
                <div
                  class="h-4 w-7 rounded-full bg-zinc-700 transition peer-checked:bg-blue-600 after:absolute after:top-0.5 after:left-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-3"
                ></div>
              </label>
              <button
                type="button"
                onclick={() => void deleteFilter(filter.id)}
                class="shrink-0 text-zinc-600 hover:text-rose-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          {/each}

          {#if showAddFilter}
            <div class="space-y-3 rounded-lg border border-white/10 bg-white/3 p-4">
              <h3 class="text-xs font-medium text-zinc-400">New rule</h3>
              <div>
                <label class="mb-1 block text-xs text-zinc-500" for="new-filter-match">Match</label>
                <CustomSelect
                  id="new-filter-match"
                  value={newFilter.match}
                  options={filterMatchOptions}
                  onchange={(value) => (newFilter.match = value as 'all' | 'any')}
                  ariaLabel="Filter match mode"
                  class="w-full sm:w-48"
                  buttonClass="px-3 py-2 text-sm"
                />
              </div>
              <div class="space-y-3">
                {#each newFilter.conditions as condition, index (`condition-${index}`)}
                  <div
                    class="grid grid-cols-1 gap-3 rounded-lg border border-white/8 bg-black/10 p-3 sm:grid-cols-5"
                  >
                    <div>
                      <label
                        class="mb-1 block text-xs text-zinc-500"
                        for={`new-filter-field-${index}`}>Field</label
                      >
                      <CustomSelect
                        id={`new-filter-field-${index}`}
                        value={condition.field}
                        options={filterFieldOptions}
                        onchange={(value) => (condition.field = String(value))}
                        ariaLabel={`Filter field ${index + 1}`}
                        class="w-full"
                        buttonClass="px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-1 block text-xs text-zinc-500"
                        for={`new-filter-condition-${index}`}>Condition</label
                      >
                      <CustomSelect
                        id={`new-filter-condition-${index}`}
                        value={condition.operator}
                        options={filterOperatorOptions}
                        onchange={(value) => (condition.operator = String(value))}
                        ariaLabel={`Filter condition ${index + 1}`}
                        class="w-full"
                        buttonClass="px-3 py-2 text-sm"
                      />
                    </div>
                    <div class="sm:col-span-2">
                      <label
                        class="mb-1 block text-xs text-zinc-500"
                        for={`new-filter-value-${index}`}>Value</label
                      >
                      <input
                        id={`new-filter-value-${index}`}
                        type="text"
                        bind:value={condition.value}
                        placeholder="e.g. newsletter@example.com"
                        class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div class="flex items-end">
                      <button
                        type="button"
                        onclick={() => removeFilterCondition(index)}
                        disabled={newFilter.conditions.length === 1}
                        class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                {/each}
                <button
                  type="button"
                  onclick={addFilterCondition}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Add condition
                </button>
              </div>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs text-zinc-500" for="new-filter-action"
                    >Action</label
                  >
                  <CustomSelect
                    id="new-filter-action"
                    value={newFilter.action}
                    options={filterActionOptions}
                    onchange={(value) => (newFilter.action = String(value))}
                    ariaLabel="Filter action"
                    class="w-full"
                    buttonClass="px-3 py-2 text-sm"
                  />
                </div>
                {#if filterTargetRequired}
                  <div>
                    <label class="mb-1 block text-xs text-zinc-500" for="new-filter-target">
                      {newFilter.action === 'move'
                        ? 'Target folder'
                        : newFilter.action === 'label'
                          ? 'Label name'
                          : newFilter.action === 'forward'
                            ? 'Forward to'
                            : 'Reply text'}
                    </label>
                    <input
                      id="new-filter-target"
                      type="text"
                      bind:value={newFilter.target}
                      placeholder={newFilter.action === 'move'
                        ? 'e.g. INBOX.Newsletters'
                        : newFilter.action === 'label'
                          ? 'e.g. Follow Up'
                          : newFilter.action === 'forward'
                            ? 'e.g. assistant@example.com'
                            : 'e.g. Thanks, I will get back to you soon.'}
                      class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                {/if}
              </div>
              {#if filterActionUnavailable}
                <p class="text-xs text-amber-300">
                  Automatic sending is disabled until SMTP safety controls are added.
                </p>
              {/if}
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  onclick={addFilter}
                  disabled={filterActionUnavailable ||
                    (filterTargetRequired && !newFilter.target.trim())}
                  class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  Add filter
                </button>
                <button
                  type="button"
                  onclick={() => void previewNewFilter()}
                  disabled={previewingFilter || newFilterConditionSet().conditions.length === 0}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {previewingFilter ? 'Previewing...' : 'Preview matches'}
                </button>
                <button
                  type="button"
                  onclick={() => (showAddFilter = false)}
                  class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
              {#if filterPreview.length > 0}
                <div class="rounded-lg border border-white/8 bg-black/20 p-3">
                  <p class="mb-2 text-xs font-medium text-zinc-400">Preview matches</p>
                  <div class="space-y-2">
                    {#each filterPreview as match (match.id)}
                      <div class="text-xs text-zinc-400">
                        <span class="text-zinc-200">{match.subject || '(no subject)'}</span>
                        <span> from {match.from || 'unknown'} in {match.mailbox}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Settings Backup -->
        <section class={settingsSectionClass('backup')}>
          <div>
            <h2 class="text-sm font-semibold tracking-widest text-zinc-500 uppercase">
              Settings Backup
            </h2>
            <p class="mt-1 text-sm text-zinc-500">
              Export and restore non-secret app settings as JSON. Passwords, client secrets, private
              keys, and push subscriptions are not included.
            </p>
          </div>

          <div class="rounded-lg border border-white/8 bg-white/3 p-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm font-medium text-zinc-200">Export settings</p>
                <p class="mt-1 text-sm text-zinc-500">
                  Includes server settings without secrets, preferences, filters, and saved
                  searches.
                </p>
              </div>
              <button
                type="button"
                onclick={() => void exportSettingsBackup()}
                disabled={exportingSettings}
                class="shrink-0 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                {exportingSettings ? 'Exporting…' : 'Export JSON'}
              </button>
            </div>
          </div>

          <div class="space-y-4 rounded-lg border border-white/8 bg-white/3 p-4">
            <div>
              <p class="text-sm font-medium text-zinc-200">Import settings</p>
              <p class="mt-1 text-sm text-zinc-500">
                Import validates the schema version and replaces selected list sections.
              </p>
            </div>

            <input
              type="file"
              accept="application/json,.json"
              onchange={selectSettingsBackupFile}
              class="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-zinc-200 hover:file:bg-white/15"
            />

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label class="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  bind:checked={restoreSettings}
                  class="rounded border-white/10"
                />
                Server settings
              </label>
              <label class="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  bind:checked={restorePreferences}
                  class="rounded border-white/10"
                />
                Interface preferences
              </label>
              <label class="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  bind:checked={restoreFilters}
                  class="rounded border-white/10"
                />
                Filters
              </label>
              <label class="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  bind:checked={restoreSavedSearches}
                  class="rounded border-white/10"
                />
                Saved searches
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onclick={() => void importSettingsBackup()}
                disabled={importingSettings || !settingsBackupFile}
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {importingSettings ? 'Importing…' : 'Import selected'}
              </button>
              {#if settingsBackupFile}
                <span class="text-sm text-zinc-500">{settingsBackupFile.name}</span>
              {/if}
            </div>

            {#if settingsBackupMessage}
              <p class="text-sm text-emerald-400">{settingsBackupMessage}</p>
            {/if}
          </div>
        </section>

        <div class="border-t border-white/8"></div>

        <!-- Save -->
        <div class="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onclick={() => void save({ manual: true, invalidate: true, clearSecrets: true })}
            disabled={saving}
            class="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {#if saveSuccess}
            <span class="text-sm text-emerald-400">Settings saved.</span>
          {:else if autosaveStatus === 'saving'}
            <span class="text-sm text-zinc-500">Autosaving...</span>
          {:else if autosaveStatus === 'saved'}
            <span class="text-sm text-emerald-400">Autosaved.</span>
          {:else if autosaveStatus === 'error'}
            <span class="text-sm text-amber-400">Autosave failed. Use Save settings to retry.</span>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<ErrorDialog
  message={errorDialogMessage}
  title="Settings error"
  onclose={() => (errorDialogMessage = null)}
/>

{#if actionModal}
  <ActionModal
    title={actionModal.title}
    message={actionModal.message}
    confirmLabel={actionModal.confirmLabel}
    cancelLabel={actionModal.cancelLabel}
    tone={actionModal.tone}
    onconfirm={() => closeActionModal(true)}
    oncancel={() => closeActionModal(null)}
  />
{/if}
