export type Screen = 'chat' | 'inbox' | 'agents' | 'mascots'

// Set by a screen with unsaved changes. It runs `proceed` itself once leaving is fine.
export type LeaveGuard = (proceed: () => void) => void
