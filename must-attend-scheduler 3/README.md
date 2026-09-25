# Corral — Must-Attend Scheduling Poll

A small Netlify + Google Sheets scheduling poll that prioritizes people who genuinely cannot miss the meeting.

## Privacy / account model

- No participant account.
- No participant email address is requested or stored.
- No organizer account or email address is required or stored.
- The organizer receives a **private organizer link** containing a random secret in the URL fragment (`#organizer=...`).
- Only a SHA-256 hash of that secret is stored in Google Sheets.
- The organizer link is also saved in that browser's `localStorage` as a convenience.
- “Email to myself” and “Open email draft” use `mailto:`. The user's own mail application handles the message; Corral never receives the email address.
- Individual participant responses are returned only to a request carrying the valid organizer secret. The public participant endpoint receives poll details, not the response roster.

Because there is deliberately no account service, a private organizer link that is lost **and** is not available in the original browser/bookmarks/email cannot be recovered by Corral. Requiring recovery across devices would mean adding an identity/recovery mechanism (usually email or another login provider).

## Scheduling behaviour

- Participants enter first and last name and answer **Yes / Maybe / No** for every proposed time.
- Times are stored as UTC instants and displayed in each viewer's browser timezone.
- Must-Attend identity matching is case-insensitive and whitespace-normalized.
- Adding a person to Must-Attend after they already responded now links an existing exact-name response dynamically.
- Duplicate capitalization variants of a participant name are treated as one participant; latest answers win.
- A time is fully eligible only when every Must-Attend person has responded for that time and none answered No.
- An unanswered Must-Attend person does **not** count as available.
- A Must-Attend “Maybe” remains eligible but is displayed as conditional.
- If an eligible recommendation is not yet possible because essential responses are missing, Corral shows a **Leading so far** state rather than a recommendation.
- Equal-scoring times are shown as ties rather than being silently broken by array order.

## Organizer sharing and reminders

The organizer view contains:

- participant link — safe to share;
- private organizer link — keep private;
- copy invitation;
- open invitation as an email draft;
- copy reminder text for outstanding Must-Attend participants;
- open that reminder as an email draft;
- email the private organizer link to yourself without Corral collecting an address.

The homepage also lists recent organizer links saved on that browser/device.

## Data storage

Google Sheets acts as the database. Corral creates these sheets automatically:

- `Polls`
- `Responses`
- `Feedback`

The `Polls` sheet includes `organizer_token_hash`; the plaintext organizer secret is never stored.

Feedback is anonymous and no longer asks for an email address. If an older deployment already collected optional feedback email addresses, updating the code will stop future collection but will not delete old Sheet values automatically.

## One-time setup

You need a Google account and a Netlify account.

### 1. Google Sheet

Create a blank Google Sheet and copy its Sheet ID from the URL.

### 2. Google Cloud service account

Enable the Google Sheets API, create a service account, create a JSON key and retain:

- `client_email`
- `private_key`

Share the Google Sheet with the service account email as Editor.

### 3. Netlify environment variables

Set:

| Key | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | service account `client_email` |
| `GOOGLE_PRIVATE_KEY` | service account `private_key` |
| `GOOGLE_SHEET_ID` | Sheet ID |

`netlify.toml` already routes `/api/*` to Netlify Functions and publishes `public/`.

## Important migration note

Organizer links from the older version looked like:

`/poll.html?id=ABC123&organizer=1`

Those links were not secure because anyone who knew the public poll ID could construct them. This version intentionally does **not** honor that flag as organizer authorization.

New polls use:

`/poll.html?id=ABC123#organizer=RANDOM_PRIVATE_SECRET`

There is no secure way to retroactively determine who owned an old poll because the older version never created an organizer credential. Old participant polls remain readable, but old organizer access cannot be safely reconstructed automatically.

## Remaining limitations

- Participant identity is intentionally trust-based. Without accounts/email verification, someone can type another person's name. Do not use Corral as an authorization or high-stakes identity system.
- Google Sheets is suitable for a beta/small-team workload, not large-scale traffic. The functions currently scan Sheet rows rather than using an indexed database.
- The 8-second organizer refresh is polling rather than realtime push.
- Browser localStorage is convenience, not durable account recovery: private browsing, clearing site data, or changing devices can remove it.
