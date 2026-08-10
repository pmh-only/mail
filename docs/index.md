---
layout: home

hero:
  name: mail
  text: Your inbox, on your server.
  tagline: A fast, SSR-first webmail client for any IMAP and SMTP account.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Deploy mail
      link: /operations/deployment
    - theme: alt
      text: Try the demo
      link: https://maildemo.pmh.codes/

features:
  - title: Standards-based mail
    details: Connect one or more IMAP and SMTP accounts without changing mail providers.
  - title: Private by default
    details: Run the web app, worker, and PostgreSQL database in infrastructure you control.
  - title: OpenPGP built in
    details: Sign, encrypt, verify, and decrypt cleartext, detached, and PGP/MIME messages.
  - title: Single-owner security
    details: Use a password, passkeys, GitHub, Discord, OpenID Connect, or a combination.
  - title: Background processing
    details: Mail sync, sending, cleanup, AI classification, and notifications run outside web requests.
  - title: Automation ready
    details: Integrate through the authenticated REST API or the built-in MCP transports.
---

## How mail runs

A production installation has two application processes. The **web process** serves the SvelteKit
application and HTTP APIs. The **worker process** owns mailbox synchronization, outgoing delivery,
cleanup, and other background jobs. Both processes share PostgreSQL and the same configuration
secrets.

Start with the [getting started guide](/guide/getting-started), or review the
[architecture](/reference/architecture) before planning a production deployment.

## Screenshots

<div class="screenshot-grid">
  <a href="./view1.png"><img src="./view1.png" alt="Mailbox and message reader" /></a>
  <a href="./view2.png"><img src="./view2.png" alt="Alternate mailbox view" /></a>
  <a href="./compose2.png"><img src="./compose2.png" alt="Message composer" /></a>
  <a href="./compose1.png"><img src="./compose1.png" alt="Compact message composer" /></a>
</div>
