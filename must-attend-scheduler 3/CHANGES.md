# Security and reliability revision

This revision keeps Corral account-free and email-free while addressing the code-review findings.

## Fixed

- Replaced public `?organizer=1` authorization with a random private organizer secret.
- Stores only the SHA-256 organizer-token hash in Google Sheets.
- Participant API no longer returns participant roster or individual responses.
- Organizer mutations require the private organizer token.
- Must-Attend unknown responses no longer count as available.
- Added provisional “Leading so far” state while essential responses are outstanding.
- Must-Attend “Maybe” is explicitly displayed as conditional.
- Existing responses dynamically match a person newly added to Must-Attend.
- Case/whitespace variants of the same participant are grouped as one identity.
- Prevents duplicate current claims to the same Must-Attend identity.
- Equal recommendation/metric scores are displayed as ties.
- Organizer update calls now check HTTP errors before changing displayed state.
- Added server-side limits, duplicate checks and deadline-before-meeting validation.
- Removed unsafe name interpolation in the poll-creation Must-Attend chips and added attribute escaping elsewhere.
- Removed optional feedback email collection/storage from new submissions.
- Replaced the normal clipboard path with the modern Clipboard API plus fallback.

## Organizer recovery without storing email

- New private organizer links are saved to localStorage on the organizer's browser.
- Homepage shows recent organizer links saved on that device.
- Added “Email to myself” using a local `mailto:` draft; Corral never receives or stores the address.
- Added copy/open-email invitation and Must-Attend reminder workflows.

## Migration

Old `?organizer=1` links cannot be made secure retroactively because the old app had no organizer credential. Create new polls after deploying this revision for protected organizer access.
