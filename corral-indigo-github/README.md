# Must-Attend Scheduling Poll

A scheduling poll site where the organizer can mark certain participants as
"Must Attend," and get transparent, numbers-first recommendations for the
best time to meet.

- Organizer creates a poll → gets a shareable link.
- Participants respond from any device, no account required.
- Times are shown to each participant in their own local timezone
  automatically — a slot proposed at 10am Eastern shows as 7am Pacific to
  someone on the west coast.
- Organizer can set an optional response deadline; after it passes,
  responses close automatically.
- Organizer can finalize/lock in a time, which confirms the meeting and
  closes further responses.
- Responses are stored in a Google Sheet (acts as the database).
- The organizer view shows live tallies and four recommendation types:
  Most Popular, Most Inclusive, Best Compromise, and Recommended (which
  respects Must-Attend availability first).

## One-time setup (about 15 minutes)

You need: a Google account, and a Netlify account (free tier is fine).

### 1. Create the Google Sheet

1. Go to [Google Sheets](https://sheets.new) and create a new blank
   spreadsheet. Name it anything, e.g. "Scheduling Poll Data."
2. Copy the Sheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART_IS_THE_ID`**`/edit`
3. Leave it otherwise empty — the app creates its own tabs ("Polls" and
   "Responses") automatically the first time it runs.

### 2. Create a Google Cloud service account

This lets the app write to your Sheet without you sharing your personal
Google login.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or use an existing one).
3. Enable the **Google Sheets API**: search "Google Sheets API" in the top
   search bar → click it → click **Enable**.
4. Go to **APIs & Services → Credentials → Create Credentials → Service
   account**. Give it any name (e.g. "scheduling-poll-bot"). Skip the
   optional role/access steps — click through to **Done**.
5. Click into the service account you just created → **Keys** tab →
   **Add Key → Create new key → JSON**. This downloads a `.json` file —
   keep it private, don't commit it anywhere public.
6. Open that JSON file. You need two values from it:
   - `client_email` — looks like `something@your-project.iam.gserviceaccount.com`
   - `private_key` — a long string starting with `-----BEGIN PRIVATE KEY-----`

### 3. Share the Sheet with the service account

1. Open your Google Sheet from step 1.
2. Click **Share**.
3. Paste in the `client_email` value from step 2 and give it **Editor**
   access. Uncheck "notify people" if it asks.

### 4. Deploy to Netlify

1. Push this project folder to a GitHub repo (or drag-and-drop deploy the
   folder directly in the Netlify dashboard, if you don't want to use git).
2. In Netlify: **Add new site → Import an existing project**, point it at
   this repo. Build settings are already set via `netlify.toml` — no build
   command needed, just the `public` folder and `netlify/functions`.
3. Once the site exists, go to **Site configuration → Environment
   variables** and add three:

   | Key | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from the JSON file |
   | `GOOGLE_PRIVATE_KEY` | the `private_key` from the JSON file, pasted as-is (including `\n` characters) |
   | `GOOGLE_SHEET_ID` | the Sheet ID from step 1 |

4. Trigger a redeploy (Netlify does this automatically after you add env
   vars, or you can click **Deploys → Trigger deploy**).

That's it — visit your Netlify site URL and you should see the "Create a
poll" page.

## How it works day-to-day

- **Organizer**: go to your site's homepage, create a poll, and you'll get
  two links — one to share with participants, one for yourself (the
  "organizer view"). Bookmark the organizer link; it's how you see results
  and manage the Must-Attend list.
- **Participants**: open the link you were sent, type your full name
  (first + last is required), answer Yes / If Needed / No for each
  proposed time, and submit. No login.
- **Must-Attend matching**: if a participant's name exactly matches
  someone on the Must-Attend list, their response is linked automatically.
  If it doesn't match (typo, nickname), the participant sees a dropdown to
  manually confirm "yes, I'm one of the Must-Attend people, just under a
  different spelling."
- **Editing the Must-Attend list after creation**: the organizer view lets
  you add or remove Must-Attend participants at any time — useful if
  responses come in before you've finalized who's essential.
- **Live updates**: the organizer view refreshes automatically every 8
  seconds to reflect new responses, and also on page load.

## What's new since the first version

- **Timezone-aware slots**: proposed times are now entered as real
  date/time values (not free-text labels) and stored as a single UTC
  instant. Every page converts that instant to whoever is looking at it —
  no manual timezone math for you or participants.
- **Response deadline**: optional, set at creation or any time afterward
  from the organizer view. Once it passes, the participant page shows a
  "Responses closed" banner and disables the form; the backend also
  rejects late submissions even if someone bypasses the UI.
- **Finalize / lock in**: from the organizer view, click "🔒 Finalize this
  time" on any slot to confirm the meeting. This shows a confirmation
  banner to everyone (organizer and participants), closes further
  responses, and can be undone ("Finalized — undo") if you change your
  mind.

## Known limitations (by design, for a v1)

- No participant accounts — someone could resubmit under the same name to
  correct their answer (later submissions overwrite earlier ones), but
  nothing stops someone from submitting under a name that isn't theirs.
  That's a reasonable trade-off for a low-stakes internal scheduling tool;
  it would need real auth for anything higher-stakes.
- Existing proposed times can't be edited or removed once responses exist
  against them (to avoid orphaning data) — you can only add new ones. If
  you need to change an existing time, it's cleanest to create a new poll.
- The 8-second refresh is polling, not push — for a handful of
  participants this is unnoticeable, but it isn't instant.


## Private organizer links (updated beta)

New polls generate a private organizer link with a random secret in the URL fragment.
The server stores only its SHA-256 hash in the existing Polls sheet, in a new
`organizer_token_hash` column added automatically. Participants use the ordinary
link and receive only the poll title, times, deadline and Must-Attend roster.
The organizer secret is sent in a request header for private reads and in the
body of mutations. Never share the organizer URL with participants.

The homepage remembers recent organizer links in that browser. “Email link to
myself” opens the user's own email app; Corral does not collect addresses.
If the link is lost across browsers/devices and was not saved, it cannot be
recovered. Old polls have no organizer secret and cannot be administered securely;
create a new poll after upgrading. Existing participant links still load.

No email addresses are stored in Polls, Responses or new Feedback submissions.
If an older Feedback sheet has a `contact_email` column, previously saved values
are not deleted automatically; review/remove that historic data separately.

A participant's full name is self-reported. This beta does not verify that the
person entering a Must-Attend name is that person. Share participant URLs only
with your intended group and confirm essential availability before finalizing.
No built-in rate limiter or identity verification is provided by this code.
