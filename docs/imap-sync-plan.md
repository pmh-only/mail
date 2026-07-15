# Thunderbird-style IMAP sync plan

## Goal

Bring pmail's IMAP synchronization closer to Thunderbird's behavior without adding a new dependency or maintaining one connection per folder.

- Inbox changes appear within about 1-2 seconds through IMAP IDLE.
- Each account uses at most two persistent IMAP connections.
- Remote read, flag, delete, and move changes are reflected locally.
- Interrupted synchronization never advances past messages that were not stored.
- Reconnects and UIDVALIDITY changes recover without mixing up UIDs.
- Servers without IDLE, CONDSTORE, or QRESYNC continue to work through polling.
- Locally saved drafts are appended to the server Drafts mailbox for other IMAP clients.

## Target architecture

```text
IMAP account
├─ Watch connection
│  └─ Select Inbox and wait in IDLE
└─ Work connection
   ├─ Process user IMAP jobs first
   └─ Poll and reconcile mailboxes
```

The watch connection only emits mailbox wake-ups. All database mutation and reconciliation runs serially through the work connection.

## Invariants

- The server is authoritative unless a local IMAP job for the same UID is pending or running.
- A mailbox cursor advances only after every required local write succeeds.
- A UID is meaningful only with its mailbox and UIDVALIDITY.
- Message bodies remain globally cached by Message-ID; mailbox membership remains UID-based.
- IDLE is an optimization. Polling remains the recovery path.
- User jobs always run before background synchronization.

## Pull request sequence

| PR  | Scope                                                              | Expected result                                             |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | Cursor safety, UIDVALIDITY, remote reconciliation, job consistency | No skipped mail or permanent local/server divergence        |
| 2   | Two persistent connections per account and Inbox IDLE              | Near-real-time Inbox updates without per-folder connections |
| 3   | STATUS, CONDSTORE, and QRESYNC optimization                        | Lower network and server cost for unchanged mailboxes       |
| 4   | Draft APPEND and server draft cleanup                              | pmail drafts are visible to other IMAP clients              |

---

## PR 1: synchronization correctness

### Database migration

Add `drizzle/0009_imap_sync_state.sql` and register it in `drizzle/meta/_journal.json`.

Extend `mailbox_sync`:

- `uid_validity bigint null`
- `highest_modseq bigint null`
- `last_reconciled_at timestamptz null`

Change IMAP UID columns from PostgreSQL `integer` to `bigint`:

- `mailbox_sync.last_uid`
- `mail_message_mailbox.uid`
- `imap_job.uid`
- `mail_thread_summary.latest_uid` (파생 요약의 UID도 같은 범위를 사용)

Use JavaScript `number` for UIDs and UIDVALIDITY. Use `bigint` for MODSEQ.

Migration behavior:

- A null UIDVALIDITY is adopted on the first run without deleting existing cache rows.
- A later UIDVALIDITY mismatch resets only mailbox membership and summaries.
- Shared `mail_message` content and thread metadata are preserved.

### Safe mailbox cursor

Replace the open-ended `${lastUid + 1}:*` fetch flow:

1. Select the mailbox.
2. Read UIDVALIDITY, UIDNEXT, HIGHESTMODSEQ, and message count.
3. Fetch new mail only when `uidNext - 1 > lastUid`.
4. Fetch the explicit range `${lastUid + 1}:${uidNext - 1}`.
5. Verify that every expected new UID received the required local writes.
6. Persist `lastUid` only after the complete mailbox run succeeds.

On failure, retain the previous cursor. Already written rows are safe to upsert on retry, and cached content avoids another full source download.

### UIDVALIDITY handling

On first observation:

- Store the server UIDVALIDITY.
- Reconcile the existing local UID set with the server.
- Do not clear message content.

On mismatch:

- Delete `mail_message_mailbox` rows for the affected mailbox.
- Delete `mail_thread_summary` rows for the affected mailbox.
- Reset `lastUid`, `highestModseq`, and `historyComplete`.
- Run a complete mailbox synchronization.
- Preserve `mail_message` and `mail_thread_metadata`.

### Remote change reconciliation

New messages:

- Use UIDNEXT to fetch only new envelope metadata.
- Reuse the current Message-ID content cache.
- Download source only when content is absent.

Flags with CONDSTORE:

- Fetch `UID`, `FLAGS`, and `MODSEQ` with `changedSince`.
- Update only changed mailbox rows.
- Persist HIGHESTMODSEQ after successful writes.

Flags without CONDSTORE:

- Keep normal new-message polling.
- Perform a metadata-only full flag reconciliation every five minutes.
- Never redownload message bodies for this fallback.

Deleted and remotely moved messages:

- Run `UID SEARCH ALL` when message count changes, UIDNEXT changes, an EXPUNGE event arrives, or five minutes pass since the last reconciliation.
- Delete local mailbox rows whose UIDs no longer exist remotely.
- Refresh affected thread summaries.
- Treat a remote move as source deletion plus a new UID in the destination mailbox.

### Pending local intent

Before applying remote flags, load pending and running IMAP jobs for the mailbox.

- Do not overwrite a UID with a pending read or unread job.
- Do not treat a UID with a pending move as remotely settled.
- Reconcile the source and destination after a job succeeds.
- Let the server win again after a job reaches final `failed` state.

### Latest read intent wins

Replace separate read and unread dedupe keys:

```text
mark_read:INBOX:123
mark_unread:INBOX:123
```

with one intent key:

```text
seen:INBOX:123
```

Upserting the key updates the job type to the latest requested state and resets its retry schedule.

Migration cleanup:

- Remove completed and failed legacy read jobs.
- For pending legacy jobs, keep only the newest row per mailbox and UID.
- Convert the survivor to the new dedupe key.

### Safe move behavior

Do not delete the local source row before IMAP MOVE succeeds.

1. Enqueue the move job.
2. Keep the row durable while the operation is pending.
3. Let the UI optimistically remove the item from its current view.
4. After IMAP MOVE succeeds, delete the source mailbox row.
5. Refresh the source summary and request a destination sync.
6. If MOVE fails permanently, leave the source row intact.

### PR 1 checklist

- [x] Add migration and schema fields.
- [x] Convert all UID database columns to `bigint`.
- [x] Read UIDVALIDITY and UIDNEXT when selecting a mailbox.
- [x] Replace open-ended new UID ranges with explicit ranges.
- [x] Advance `lastUid` only after successful completion.
- [x] Detect and recover from UIDVALIDITY changes.
- [x] Reconcile remote flags.
- [x] Reconcile remote deletes and moves.
- [x] Protect pending local intents from polling overwrite.
- [x] Coalesce read and unread jobs to one latest-intent key.
- [x] Delete a source row only after MOVE succeeds.
- [x] Refresh every affected thread summary.
- [x] Add focused failure and reconciliation tests.

### PR 1 acceptance checks

- [ ] Force a source-fetch failure halfway through a mailbox and verify the next run stores every message.
- [ ] Mark a message read in webmail and verify pmail updates it.
- [ ] Mark a message unread in webmail and verify pmail updates it.
- [ ] Delete a message in webmail and verify its local mailbox row disappears.
- [ ] Move a message in webmail and verify source and destination membership.
- [ ] Simulate a UIDVALIDITY change and verify clean mailbox rebuilding.
- [ ] Queue read then unread while offline and verify unread is the final server state.
- [ ] Fail an IMAP MOVE permanently and verify the source message remains visible.

---

## PR 2: persistent connections and Inbox IDLE

### Connection ownership

Add `src/lib/server/imap-connections.ts` with a small account map:

```ts
Map<
  config.id,
  {
    watcher: ImapFlow | null
    worker: ImapFlow | null
  }
>
```

Required operations:

- Start connections for configured accounts.
- Return the reusable work connection for an account.
- Restart only the account whose connection settings changed.
- Stop all connections during worker shutdown.

Do not add a generic pool implementation or a pool-size setting.

### Watch connection

For each account:

1. Connect and select the configured Inbox.
2. Register `exists`, `expunge`, `flags`, `close`, and `error` listeners.
3. Enter IDLE.
4. Restart IDLE every 25 minutes.
5. Reconnect with exponential backoff after disconnect.

Events request mailbox synchronization but never write directly to the database.

### Event coalescing

Maintain one dirty bit per account and mailbox:

- The first event schedules a sync.
- Events received before the sync starts are merged.
- Events received during a sync set the dirty bit again.
- After completion, run at most one additional sync when dirty.

This prevents event storms from creating one synchronization run per message.

### Work connection

Reuse one work connection per account for:

- read and unread jobs
- MOVE jobs
- flag jobs
- mailbox LIST and STATUS
- message FETCH and SEARCH
- reconciliation

Use `getMailboxLock()` to serialize mailbox selection. Do not logout after each operation.

Work priority:

1. Ready user IMAP jobs
2. Inbox IDLE wake-ups
3. Regular mailbox polling
4. Cleanup work

### Lifecycle and fallback

Worker startup:

1. Run migrations.
2. Recover interrupted jobs.
3. Load account configuration.
4. Start watcher and work connections.
5. Start the existing tick loop.

Graceful shutdown:

1. Stop accepting new work.
2. Finish the current database operation.
3. Logout watcher connections.
4. Logout work connections.

Fallback rules:

- If IDLE is unsupported, use the existing poll interval.
- If the watcher is disconnected, polling continues through the work connection.
- If the work connection closes, the current job returns to pending and reconnects.
- Account configuration changes restart only the affected account connections.
- Credentials must never appear in logs.

### PR 2 checklist

- [x] Add the account connection manager.
- [x] Keep one watcher and one work connection per account.
- [x] Attach Inbox IDLE event listeners.
- [x] Add mailbox wake-up coalescing.
- [x] Reuse work connections in the IMAP job worker.
- [x] Reuse work connections in mailbox synchronization.
- [x] Prioritize user jobs over background work.
- [x] Add reconnect backoff.
- [x] Keep polling alive while the watcher is unavailable.
- [x] Restart changed account connections only.
- [x] Close all connections on SIGTERM and SIGINT.
- [x] Add connection-limit and event-coalescing tests.

### PR 2 acceptance checks

- [ ] Receive a new Inbox message within about two seconds.
- [ ] Verify connection count never exceeds two per account.
- [x] Send 100 synthetic events and observe one coalesced sync.
- [ ] Disconnect the watcher and verify polling still receives mail.
- [ ] Disconnect the work connection and verify jobs retry.
- [ ] Leave IDLE running for more than 30 minutes.
- [ ] Restart the worker during an IMAP job and verify recovery.
- [ ] Verify two accounts never share credentials or remote mailbox paths.

---

## PR 3: adaptive synchronization

### STATUS fast path

Before opening a mailbox, request:

- UIDNEXT
- UIDVALIDITY
- HIGHESTMODSEQ
- MESSAGES
- UNSEEN

Skip mailbox selection and FETCH when all available values are unchanged and no full reconciliation is due.

### CONDSTORE

When HIGHESTMODSEQ is supported:

- Fetch only messages changed since the stored MODSEQ.
- Apply flag changes.
- Store the new MODSEQ after successful writes.

### QRESYNC

Enable ImapFlow's existing `qresync` option.

- Use UID-bearing EXPUNGE events when the server provides them.
- Remove the exact local mailbox row immediately through the work queue.
- Retain periodic UID SEARCH reconciliation to recover events missed while disconnected.

Do not issue custom raw IMAP commands or depend on ImapFlow internals.

### Mailbox priority

Retain the current ordering:

1. Inbox
2. Sent
3. Drafts
4. Archive or All Mail
5. Regular folders
6. Spam and Trash

During a large backfill, yield between existing chunks and check ready user jobs before continuing.

### PR 3 checklist

- [x] Add STATUS preflight checks.
- [x] Skip unchanged mailboxes.
- [x] Use `changedSince` when CONDSTORE is available.
- [x] Enable QRESYNC through public ImapFlow options.
- [x] Handle UID-bearing EXPUNGE events.
- [x] Keep UID SEARCH as reconnect recovery.
- [x] Preserve fallback behavior for servers without extensions.
- [x] Measure request count and mailbox duration before and after.
- [x] Add extension and fallback tests.

### PR 3 acceptance checks

- [x] Verify an unchanged mailbox performs no message FETCH.
- [ ] Verify only changed flags are returned with CONDSTORE.
- [ ] Verify QRESYNC EXPUNGE removes the correct UID.
- [ ] Verify missed deletions are recovered after reconnect.
- [ ] Verify a server without CONDSTORE still converges correctly.
- [ ] Verify user jobs interrupt background backfill between chunks.

---

## Minimum capability fallbacks

Capability fallback is implemented with the PR that introduces each feature, not as a separate compatibility layer.

| Capability unavailable | Required fallback                                                     |
| ---------------------- | --------------------------------------------------------------------- |
| IDLE                   | Continue using `pollSeconds` polling                                  |
| CONDSTORE              | Perform a metadata-only full flag reconciliation every five minutes   |
| QRESYNC                | Compare server and local UIDs with `UID SEARCH ALL`                   |
| MOVE                   | Use UID COPY, mark the source deleted, and UID EXPUNGE when supported |
| UIDPLUS / COPYUID      | Reconcile the destination mailbox instead of guessing its UID         |
| APPENDUID              | Find the appended draft through its stable pmail draft header         |
| SPECIAL-USE            | Keep the existing mailbox role-name matching                          |

Fallback rules:

- [x] Check advertised capabilities before using an extension.
- [x] Treat a command that is advertised but rejected as unavailable for that connection.
- [x] Never advance a cursor after an ambiguous or partial response.
- [x] Reconcile after an operation whose server result is unknown.
- [x] Preserve the polling path even when IDLE is active.
- [ ] Add a focused regression test before adding any server-specific workaround.

---

## PR 4: Draft APPEND

### Scope

Keep the current PostgreSQL `mail_draft` row as the durable editing source and synchronize pmail-created drafts to the configured server Drafts mailbox.

This PR does not turn arbitrary remote Drafts messages into editable pmail composer drafts. Remote drafts remain readable as normal IMAP messages.

### Draft sync state

Extend `mail_draft` with nullable server state:

- `imap_mailbox`
- `imap_uid bigint`
- `imap_uid_validity bigint`
- `imap_synced_at`
- `imap_sync_error`

Add a nullable `draft_id` to `imap_job`. Draft jobs use `draft:<id>` as their dedupe key so repeated 30-second autosaves update one pending job instead of appending every intermediate version.

### APPEND flow

1. Save the latest draft content in `mail_draft`.
2. Upsert one `append_draft` job in the same database transaction.
3. Load the latest draft version when the worker executes the job.
4. Build one complete RFC 5322 message, including attachments.
5. Add `\Draft` and a stable `X-Pmail-Draft-ID` header.
6. APPEND the new version before deleting the old server UID.
7. Store APPENDUID, mailbox, UIDVALIDITY, and sync time.
8. Remove the previous server draft only after the new version is confirmed.

If APPEND succeeds but its response is lost, search the Drafts mailbox for `X-Pmail-Draft-ID` before retrying. This prevents duplicate drafts when the result is ambiguous.

### Draft deletion and sending

When a local draft is deleted or successfully sent:

1. Enqueue `delete_draft` with the known mailbox and UID.
2. Remove the local draft only after the deletion job is durable.
3. Treat a missing remote UID as success.
4. Reconcile the Drafts mailbox after completion.

A failed server cleanup must not fail message delivery. It remains retryable and visible in queue health.

### Draft update conflicts

- The pmail `mail_draft` row is authoritative for drafts created by pmail.
- The newest local save replaces older pending APPEND work.
- A pmail draft found multiple times remotely is reduced to the newest version after a successful APPEND.
- UIDVALIDITY mismatch clears the stored server UID and searches by stable draft header before appending.

### PR 4 checklist

- [x] Add draft IMAP state columns and migration.
- [x] Add `draft_id` support to IMAP jobs.
- [x] Enqueue APPEND in the same transaction as local draft saving.
- [x] Build RFC 5322 content from the current draft and attachments.
- [x] Add `\Draft` and stable pmail draft identity headers.
- [x] Resolve the server Drafts mailbox through SPECIAL-USE, then role-name fallback.
- [x] APPEND the new version before deleting the previous version.
- [x] Save APPENDUID and UIDVALIDITY when available.
- [x] Fall back to header search when APPENDUID is unavailable or ambiguous.
- [x] Enqueue remote cleanup when deleting or sending a draft.
- [x] Surface final draft sync failures through queue health.
- [x] Add focused APPEND, retry, dedupe, and deletion tests.

### PR 4 acceptance checks

- [ ] Save a pmail draft and open it from another IMAP client.
- [ ] Update the draft repeatedly and verify only the newest version remains.
- [x] Save a draft with attachments and verify the complete MIME message.
- [ ] Disconnect during APPEND and verify retry does not create duplicates.
- [ ] Delete a draft and verify it disappears from the server Drafts mailbox.
- [ ] Send a draft and verify delivery succeeds even if draft cleanup is delayed.
- [ ] Change UIDVALIDITY and verify draft identity recovery through header search.
- [ ] Verify a server without APPENDUID still converges correctly.

---

## Verification commands

Local migration verification (2026-07-15): PostgreSQL 17 applied migrations `0000` through
`0010` over seeded mailbox, message, summary, legacy IMAP job, and draft rows. The check
confirmed data preservation, unsigned 32-bit UID values in widened columns, legacy read-job
cleanup with the newest pending intent retained, and nullable Draft APPEND jobs.

Run after every PR:

```sh
./node_modules/.bin/svelte-kit sync
./node_modules/.bin/svelte-check --tsconfig ./tsconfig.json
./node_modules/.bin/prettier --check .
./node_modules/.bin/eslint .
node --test \
  src/lib/imap-sync.test.ts \
  src/lib/read-state.test.ts \
  src/lib/server/draft-message.test.ts \
  src/lib/server/imap-connections.test.ts \
  src/lib/server/threading.test.ts
env DATABASE_URL=postgres://localhost/pmail ./node_modules/.bin/vite build
env DATABASE_URL=postgres://localhost/pmail ./node_modules/.bin/vite build --config vite.worker.config.ts
```

Add the new focused sync tests to the `node --test` command as they land.

## Rollout checklist

### Before deployment

- [x] Confirm the migration is additive and reviewed.
- [x] Confirm no credentials are logged.
- [x] Confirm the worktree contains only the intended PR scope.
- [ ] Record current queue health and mailbox sync status.
- [ ] Confirm a database backup exists.

### After PR 1 deployment

- [ ] Confirm migration completion.
- [ ] Confirm existing mailbox rows remain available.
- [ ] Check sync errors and failed IMAP jobs for 24 hours.
- [ ] Compare read, delete, and move behavior with webmail.
- [ ] Confirm no unexpected full source redownload.

### After PR 2 deployment

- [ ] Confirm no more than two IMAP connections per account.
- [ ] Measure Inbox event-to-display latency.
- [ ] Verify polling continues after watcher disconnect.
- [ ] Verify clean worker shutdown and restart.

### After PR 3 deployment

- [ ] Compare FETCH count and bytes with the previous version.
- [ ] Confirm unchanged mailboxes use the STATUS fast path.
- [ ] Confirm extension fallback on at least one non-CONDSTORE path.
- [ ] Confirm reconciliation still recovers missed events.

### After PR 4 deployment

- [ ] Confirm pmail drafts appear in another IMAP client.
- [ ] Confirm repeated autosaves do not accumulate remote copies.
- [ ] Confirm sent and deleted drafts are cleaned up remotely.
- [ ] Confirm an APPEND timeout recovers without duplicate drafts.

## Rollback checklist

- [ ] Stop the worker before rolling back application code.
- [ ] Roll back code without removing the additive sync columns.
- [ ] Restart the previous polling worker.
- [ ] Reset a mailbox cursor only when its state is demonstrably inconsistent.
- [ ] Do not delete shared `mail_message` content during rollback.
- [ ] Re-run a full mailbox sync when UIDVALIDITY cannot be trusted.

## Explicitly out of scope

- Configurable connection-pool size
- One IDLE connection per folder
- New queue or pooling dependencies
- JMAP support
- Frontend tracking of the currently viewed folder
- A general browser-offline operation journal beyond draft jobs
- Editing arbitrary remote Drafts messages in the pmail composer
- Gmail-specific label semantics
- Shared mailbox namespace, ACL, and quota management
- Dynamic connection-pool sizing
- Deferred body download and offline-body storage policies
- Preemptive vendor-specific IMAP workarounds without a reproduced failure
- A new monitoring dashboard
- SQLite support; this repository currently uses PostgreSQL

Add these only when measured usage shows the two-connection design is insufficient.
