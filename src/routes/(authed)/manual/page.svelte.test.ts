// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import { shortcutHelpGroups } from '$lib/shortcut-help'
import ManualPage from './+page.svelte'

describe('Manual page', () => {
  it('renders all keyboard shortcut groups', () => {
    render(ManualPage)
    expect(screen.getByRole('heading', { name: 'Manual' })).toBeInTheDocument()
    for (const group of shortcutHelpGroups) {
      expect(screen.getByRole('heading', { name: group.title })).toBeInTheDocument()
      for (const row of group.rows) expect(screen.getAllByText(row.desc).length).toBeGreaterThan(0)
    }
  })

  it('documents major mail features', () => {
    render(ManualPage)
    for (const feature of [
      'Bulk actions',
      'Drafts',
      'Attachments',
      'Contact autocomplete',
      'Signature',
      'Filters',
      'Threaded view',
      'Push notifications',
      'Unread badge',
      'Sharing'
    ]) {
      expect(screen.getByRole('heading', { name: feature })).toBeInTheDocument()
    }
  })
})
