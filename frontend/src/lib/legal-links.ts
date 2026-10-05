/**
 * The footer's legal/support labels and the app version, shared by the desktop footer (AppFooter) and
 * the phone's Settings list (LegalLinks) so the two can never drift apart.
 *
 * They are plain labels, not links: this app has no Privacy/Terms/Refund/Support pages or routes yet.
 * When one exists, give it a `to` here and both surfaces become real links in one change.
 */
export const POLICY_LINKS = ['Privacy Policy', 'Terms of Use', 'Refund Policy', 'Support'];

export const APP_VERSION = '1.0.0';
