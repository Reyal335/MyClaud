// ACCOUNT has no nav button: the meter at the bottom of the sidebar opens it.
export type Screen = 'chat' | 'inbox' | 'agents' | 'mascots' | 'account'

// Set by a screen with unsaved changes. It runs `proceed` itself once leaving is fine.
export type LeaveGuard = (proceed: () => void) => void
