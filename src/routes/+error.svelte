<script lang="ts">
  import { page } from '$app/state'
  import { resolve } from '$app/paths'
  import favicon from '$lib/assets/favicon.svg'
  import { ArrowLeft, Home, RotateCw } from 'lucide-svelte'

  const isNotFound = $derived(page.status === 404)
  const title = $derived(isNotFound ? 'This page missed its destination.' : 'Delivery interrupted.')
  const description = $derived(
    isNotFound
      ? 'The address may be outdated, or the page may have moved somewhere new.'
      : 'Something unexpected stopped this page from loading. Your mail is still safe.'
  )

  function goBack() {
    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.href = resolve('/')
  }

  function retry() {
    window.location.reload()
  }
</script>

<svelte:head>
  <title>{page.status} · Mail</title>
  <meta
    name="description"
    content={isNotFound
      ? 'The requested page could not be found.'
      : 'The requested page could not load.'}
  />
</svelte:head>

<main class="error-page">
  <div class="ambient ambient-top" aria-hidden="true"></div>
  <div class="ambient ambient-bottom" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>

  <header class="brand">
    <a href={resolve('/')} aria-label="Mail home">
      <span class="brand-mark"><img src={favicon} alt="" /></span>
      <span>Mail</span>
    </a>
    <span class="status-chip">Status {page.status}</span>
  </header>

  <section class="error-card" aria-labelledby="error-title">
    <div class="copy">
      <p class="eyebrow">{isNotFound ? 'Return to sender' : 'Service notice'}</p>
      <div class="status-number" aria-hidden="true">{page.status}</div>
      <h1 id="error-title">{title}</h1>
      <p class="description">{description}</p>

      <div class="actions">
        <a class="primary-action" href={resolve('/')}>
          <Home size={17} strokeWidth={1.8} />
          Back to inbox
        </a>
        <button class="secondary-action" type="button" onclick={goBack}>
          <ArrowLeft size={17} strokeWidth={1.8} />
          Go back
        </button>
      </div>

      {#if !isNotFound}
        <button class="retry-action" type="button" onclick={retry}>
          <RotateCw size={14} strokeWidth={1.8} />
          Try loading this page again
        </button>
      {/if}
    </div>

    <div class="illustration" aria-hidden="true">
      <div class="route route-one"></div>
      <div class="route route-two"></div>
      <span class="route-dot dot-one"></span>
      <span class="route-dot dot-two"></span>

      <div class="envelope-shadow"></div>
      <div class="envelope">
        <div class="letter">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="envelope-back"></div>
        <div class="envelope-fold-left"></div>
        <div class="envelope-fold-right"></div>
        <div class="envelope-fold-bottom"></div>
        <div class="stamp">{page.status}</div>
      </div>

      <div class="destination">
        <span class="destination-pulse"></span>
        <span class="destination-core"></span>
      </div>
    </div>
  </section>

  <footer>
    <span>Nothing was sent or changed.</span>
    <span class="footer-rule" aria-hidden="true"></span>
    <span
      >{isNotFound
        ? 'Check the address and try again.'
        : 'A quick retry usually does the trick.'}</span
    >
  </footer>
</main>

<style>
  .error-page {
    position: relative;
    isolation: isolate;
    display: flex;
    min-height: 100svh;
    flex-direction: column;
    overflow: hidden;
    padding: max(1.25rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right))
      max(1.25rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
    color: #f4f4f5;
  }

  .error-page::before {
    position: absolute;
    z-index: -3;
    inset: 0;
    background:
      linear-gradient(rgba(7, 8, 13, 0.74), rgba(7, 8, 13, 0.88)), var(--app-theme-gradient);
    content: '';
  }

  .error-page::after {
    position: absolute;
    z-index: -2;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: linear-gradient(to bottom, black, transparent 78%);
    content: '';
  }

  .ambient {
    position: absolute;
    z-index: -1;
    width: 34rem;
    height: 34rem;
    border-radius: 999px;
    filter: blur(2px);
    opacity: 0.2;
  }

  .ambient-top {
    top: -23rem;
    right: -9rem;
    border: 1px solid rgba(125, 211, 252, 0.4);
    box-shadow: inset 0 0 9rem rgba(59, 130, 246, 0.24);
  }

  .ambient-bottom {
    bottom: -28rem;
    left: -8rem;
    border: 1px solid rgba(196, 181, 253, 0.34);
    box-shadow: inset 0 0 9rem rgba(124, 58, 237, 0.2);
  }

  .grain {
    position: absolute;
    z-index: 4;
    inset: 0;
    pointer-events: none;
    opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.8'/%3E%3C/svg%3E");
  }

  .brand {
    display: flex;
    width: min(100%, 72rem);
    align-items: center;
    justify-content: space-between;
    margin: 0 auto;
  }

  .brand a {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    gap: 0.7rem;
    color: #fafafa;
    font-size: 0.95rem;
    font-weight: 650;
    letter-spacing: -0.015em;
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    width: 2.35rem;
    height: 2.35rem;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.07);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .brand-mark img {
    width: 1.15rem;
    height: 1.15rem;
  }

  .status-chip {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    background: rgba(8, 9, 14, 0.3);
    color: rgba(228, 228, 231, 0.62);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.67rem;
    letter-spacing: 0.08em;
    padding: 0.45rem 0.7rem;
    text-transform: uppercase;
  }

  .error-card {
    display: grid;
    width: min(100%, 72rem);
    flex: 1;
    align-items: center;
    gap: clamp(2.5rem, 7vw, 7rem);
    margin: clamp(3rem, 8vh, 6rem) auto;
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.9fr);
  }

  .copy {
    max-width: 35rem;
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin: 0 0 1.25rem;
    color: #93c5fd;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.19em;
    text-transform: uppercase;
  }

  .eyebrow::before {
    width: 1.75rem;
    height: 1px;
    background: currentColor;
    content: '';
  }

  .status-number {
    margin-bottom: -0.15em;
    color: transparent;
    font-size: clamp(5.5rem, 13vw, 9.5rem);
    font-weight: 750;
    letter-spacing: -0.085em;
    line-height: 0.78;
    -webkit-text-stroke: 1px rgba(255, 255, 255, 0.16);
    text-shadow: 0 16px 50px rgba(59, 130, 246, 0.13);
  }

  h1 {
    max-width: 32rem;
    margin: 1.6rem 0 0;
    color: #fafafa;
    font-size: clamp(2.15rem, 5vw, 4rem);
    font-weight: 650;
    letter-spacing: -0.052em;
    line-height: 0.98;
    text-wrap: balance;
  }

  .description {
    max-width: 31rem;
    margin: 1.4rem 0 0;
    color: rgba(212, 212, 216, 0.68);
    font-size: clamp(0.96rem, 1.5vw, 1.08rem);
    line-height: 1.75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 2rem;
  }

  .primary-action,
  .secondary-action {
    display: inline-flex;
    min-height: 2.85rem;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    border-radius: 0.85rem;
    font-size: 0.86rem;
    font-weight: 600;
    padding: 0.75rem 1rem;
    text-decoration: none;
  }

  .primary-action {
    border: 1px solid rgba(147, 197, 253, 0.32);
    background: #f4f4f5;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.2);
    color: #111827;
  }

  .primary-action:hover {
    background: #ffffff;
    box-shadow: 0 14px 42px rgba(0, 0, 0, 0.3);
  }

  .secondary-action {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.055);
    color: #e4e4e7;
  }

  .secondary-action:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.09);
  }

  .retry-action {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    gap: 0.45rem;
    border: 0;
    margin-top: 1rem;
    background: transparent;
    color: rgba(161, 161, 170, 0.78);
    font-size: 0.77rem;
    padding: 0.35rem 0;
  }

  .retry-action:hover {
    color: #d4d4d8;
  }

  .illustration {
    position: relative;
    width: min(100%, 29rem);
    aspect-ratio: 1 / 0.92;
    justify-self: end;
  }

  .illustration::before,
  .illustration::after {
    position: absolute;
    border: 1px solid rgba(255, 255, 255, 0.075);
    border-radius: 50%;
    content: '';
  }

  .illustration::before {
    inset: 7% 4% 3% 8%;
  }

  .illustration::after {
    inset: 18% 15% 14% 19%;
    border-style: dashed;
    opacity: 0.7;
  }

  .route {
    position: absolute;
    border: 1px dashed rgba(147, 197, 253, 0.26);
    border-radius: 50%;
  }

  .route-one {
    inset: 2% 18% 20% 0;
    transform: rotate(-17deg);
  }

  .route-two {
    inset: 25% 1% 4% 25%;
    border-color: rgba(196, 181, 253, 0.18);
    transform: rotate(20deg);
  }

  .route-dot {
    position: absolute;
    z-index: 2;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: #93c5fd;
    box-shadow: 0 0 1.25rem rgba(147, 197, 253, 0.9);
  }

  .dot-one {
    top: 17%;
    left: 14%;
  }

  .dot-two {
    right: 15%;
    bottom: 20%;
    background: #c4b5fd;
  }

  .envelope-shadow {
    position: absolute;
    z-index: 1;
    right: 15%;
    bottom: 16%;
    width: 62%;
    height: 18%;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.44);
    filter: blur(26px);
    transform: rotate(-7deg);
  }

  .envelope {
    position: absolute;
    z-index: 3;
    top: 27%;
    left: 17%;
    width: 67%;
    aspect-ratio: 1.42;
    filter: drop-shadow(0 28px 28px rgba(0, 0, 0, 0.3));
    transform: rotate(-7deg);
  }

  .envelope-back {
    position: absolute;
    inset: 0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.75rem;
    background: linear-gradient(145deg, #334155, #172033);
  }

  .letter {
    position: absolute;
    z-index: 1;
    top: -18%;
    right: 9%;
    width: 75%;
    height: 72%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 0.55rem 0.55rem 0.2rem 0.2rem;
    background: linear-gradient(155deg, #f4f4f5 0%, #dbeafe 100%);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
    padding: 13% 12%;
  }

  .letter span {
    display: block;
    height: 3px;
    border-radius: 999px;
    margin-bottom: 8%;
    background: #94a3b8;
    opacity: 0.62;
  }

  .letter span:nth-child(1) {
    width: 42%;
    background: #3b82f6;
  }

  .letter span:nth-child(2) {
    width: 78%;
  }

  .letter span:nth-child(3) {
    width: 58%;
  }

  .envelope-fold-left,
  .envelope-fold-right,
  .envelope-fold-bottom {
    position: absolute;
    z-index: 2;
    inset: 0;
    border-radius: 0.7rem;
  }

  .envelope-fold-left {
    background: linear-gradient(35deg, #253650 0 49.5%, transparent 50%);
  }

  .envelope-fold-right {
    background: linear-gradient(-35deg, #1e2a41 0 49.5%, transparent 50%);
  }

  .envelope-fold-bottom {
    background: linear-gradient(145deg, transparent 0 49.5%, #334965 50%);
    clip-path: polygon(0 100%, 100% 100%, 100% 50%, 50% 100%, 0 50%);
  }

  .stamp {
    position: absolute;
    z-index: 4;
    right: 8%;
    bottom: 11%;
    display: grid;
    width: 2.6rem;
    height: 2.6rem;
    place-items: center;
    border: 1px solid rgba(191, 219, 254, 0.45);
    border-radius: 50%;
    color: #bfdbfe;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    transform: rotate(13deg);
  }

  .stamp::after {
    position: absolute;
    inset: 3px;
    border: 1px dashed rgba(191, 219, 254, 0.34);
    border-radius: inherit;
    content: '';
  }

  .destination {
    position: absolute;
    top: 12%;
    right: 9%;
    width: 2rem;
    height: 2rem;
  }

  .destination-pulse,
  .destination-core {
    position: absolute;
    border-radius: 50%;
  }

  .destination-pulse {
    inset: 0;
    border: 1px solid rgba(147, 197, 253, 0.45);
    animation: pulse 2.4s ease-out infinite;
  }

  .destination-core {
    inset: 0.78rem;
    background: #bfdbfe;
    box-shadow: 0 0 1.1rem #60a5fa;
  }

  footer {
    display: flex;
    width: min(100%, 72rem);
    align-items: center;
    gap: 0.75rem;
    margin: 0 auto;
    color: rgba(161, 161, 170, 0.52);
    font-size: 0.68rem;
    letter-spacing: 0.025em;
  }

  .footer-rule {
    width: 1.6rem;
    height: 1px;
    background: rgba(255, 255, 255, 0.13);
  }

  @keyframes pulse {
    0% {
      opacity: 0.8;
      transform: scale(0.35);
    }
    75%,
    100% {
      opacity: 0;
      transform: scale(1.2);
    }
  }

  @media (max-width: 760px) {
    .error-page {
      padding-inline: max(1.1rem, env(safe-area-inset-left));
    }

    .error-card {
      gap: 1.5rem;
      margin-block: 2.75rem 2rem;
      grid-template-columns: 1fr;
    }

    .copy {
      max-width: none;
    }

    .illustration {
      width: min(100%, 21rem);
      margin: -0.25rem auto 0;
      grid-row: 1;
      justify-self: center;
    }

    .status-number {
      font-size: clamp(5rem, 27vw, 7.25rem);
    }

    h1 {
      max-width: 25rem;
      font-size: clamp(2rem, 10vw, 3.1rem);
    }
  }

  @media (max-width: 420px) {
    .illustration {
      width: min(86vw, 18rem);
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr;
    }

    footer {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.35rem;
    }

    .footer-rule {
      display: none;
    }
  }

  :global(:root[data-theme='light']) .error-page {
    color: #0f172a;
  }

  :global(:root[data-theme='light']) .error-page::before {
    background:
      linear-gradient(rgba(248, 250, 252, 0.79), rgba(241, 245, 249, 0.9)),
      var(--app-theme-gradient);
  }

  :global(:root[data-theme='light']) .error-page::after {
    background-image:
      linear-gradient(rgba(15, 23, 42, 0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(15, 23, 42, 0.045) 1px, transparent 1px);
  }

  :global(:root[data-theme='light']) .brand a,
  :global(:root[data-theme='light']) h1 {
    color: #0f172a;
  }

  :global(:root[data-theme='light']) .brand-mark,
  :global(:root[data-theme='light']) .status-chip,
  :global(:root[data-theme='light']) .secondary-action {
    border-color: rgba(15, 23, 42, 0.12);
    background: rgba(255, 255, 255, 0.48);
  }

  :global(:root[data-theme='light']) .brand-mark img {
    filter: brightness(0.35);
  }

  :global(:root[data-theme='light']) .status-chip,
  :global(:root[data-theme='light']) .description,
  :global(:root[data-theme='light']) footer,
  :global(:root[data-theme='light']) .retry-action {
    color: rgba(51, 65, 85, 0.72);
  }

  :global(:root[data-theme='light']) .status-number {
    -webkit-text-stroke-color: rgba(15, 23, 42, 0.18);
  }

  :global(:root[data-theme='light']) .secondary-action {
    color: #334155;
  }

  :global(:root[data-theme='light']) .primary-action {
    background: #172033;
    color: #ffffff;
  }

  :global(:root[data-theme='light']) .illustration::before,
  :global(:root[data-theme='light']) .illustration::after {
    border-color: rgba(15, 23, 42, 0.11);
  }

  @media (prefers-reduced-motion: reduce) {
    .destination-pulse {
      animation: none;
      opacity: 0.35;
    }
  }
</style>
