<script lang="ts">
  import { KeyRound, LockKeyhole, ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-svelte'

  type Props = {
    signed?: boolean
    signatureStatus?: string | null
    signer?: string | null
    fingerprint?: string | null
    encrypted?: boolean
    decrypted?: boolean
    error?: string | null
    compact?: boolean
  }

  let {
    signed = false,
    signatureStatus = null,
    signer = null,
    fingerprint = null,
    encrypted = false,
    decrypted = false,
    error = null,
    compact = false
  }: Props = $props()

  const signatureLabel = $derived(
    signatureStatus === 'valid'
      ? 'Verified OpenPGP signature'
      : signatureStatus === 'valid-untrusted'
        ? 'Valid OpenPGP signature from an untrusted key'
        : signatureStatus === 'valid-mismatch'
          ? 'Valid signature, but signer does not match From'
          : signatureStatus === 'invalid'
            ? 'Invalid OpenPGP signature'
            : 'OpenPGP signature could not be verified'
  )
  const signatureClass = $derived(
    signatureStatus === 'valid'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
      : signatureStatus === 'valid-untrusted'
        ? 'border-sky-500/25 bg-sky-500/10 text-sky-300'
        : signatureStatus === 'valid-mismatch'
          ? 'border-amber-500/25 bg-amber-500/10 text-amber-200'
          : signatureStatus === 'invalid'
            ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
            : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
  )
</script>

{#if signed || encrypted}
  <div class="flex flex-wrap gap-1.5" aria-label="OpenPGP security">
    {#if signed}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs {signatureClass}"
        data-app-tooltip={[
          signatureLabel,
          signer,
          fingerprint ? `Fingerprint: ${fingerprint}` : null,
          'OpenPGP/MIME does not authenticate outer headers such as Subject.',
          error
        ]
          .filter(Boolean)
          .join('\n')}
      >
        {#if signatureStatus === 'valid'}
          <ShieldCheck size={compact ? 11 : 12} />
        {:else if signatureStatus === 'invalid'}
          <ShieldX size={compact ? 11 : 12} />
        {:else}
          <ShieldQuestion size={compact ? 11 : 12} />
        {/if}
        {compact
          ? signatureStatus === 'valid'
            ? 'PGP verified'
            : signatureStatus === 'valid-untrusted'
              ? 'PGP untrusted'
              : signatureStatus === 'valid-mismatch'
                ? 'PGP mismatch'
                : signatureStatus === 'invalid'
                  ? 'PGP invalid'
                  : 'PGP unknown'
          : signatureLabel}
      </span>
    {/if}
    {#if encrypted}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs {decrypted
          ? 'border-sky-500/25 bg-sky-500/10 text-sky-300'
          : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}"
        data-app-tooltip={decrypted
          ? 'OpenPGP message decrypted successfully'
          : error || 'Unable to decrypt OpenPGP message'}
      >
        {#if decrypted}<LockKeyhole size={compact ? 11 : 12} />{:else}<KeyRound
            size={compact ? 11 : 12}
          />{/if}
        {decrypted ? 'PGP decrypted' : 'PGP encrypted'}
      </span>
    {/if}
  </div>
{/if}
