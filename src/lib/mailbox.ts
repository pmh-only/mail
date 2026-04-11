/**
 * Converts an IMAP mailbox path to a URL-safe slug.
 * `/` → `~`  (tilde is URL-safe and won't appear in folder names)
 * Spaces → `-`
 * Brackets stripped (e.g. [Gmail])
 */
export function pathToSlug(path: string): string {
	return path.toLowerCase().replace(/[[\]]/g, '').replace(/\//g, '~').replace(/\s+/g, '-');
}

export function slugToPath(slug: string, mailboxes: { path: string }[]): string {
	return mailboxes.find((mb) => pathToSlug(mb.path) === slug)?.path ?? slug;
}
