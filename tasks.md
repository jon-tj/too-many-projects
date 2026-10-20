## Currencies on bills

- **Decision:** currency per project in billing settings, default USD.
- **Status:** done: currency dropdown in billing settings (USD default, saved per project); every amount on reports, bills and the overview shows it. Bills from before keep USD. The overview's bill list uses the project's current currency.

## Optimistic idle/working switch, dont wait for database

- **Status:** done: the switch (and the end-of-work dialog) responds at once; if the server refuses, it switches back with a message.

## When i submit a new task from dashboard, immediately close the modal

Also would be nice to have a small animation when the task shows up in the To do column. like make it look like its dropping down from above and display some (3 maybe) stars shooting out from behind it

- **Decision:** the "New task" dialog on the project board closes at once; the card drops into To do with three stars.
- **Status:** done: the dialog closes on submit; the card drops in with three stars once saved (an error names the task if saving fails). Reduced motion skips the animation.

## Weekly summary email

- **Decision:** everyone with activity last week, Monday morning: per project hours, tasks done, mood/resistance. On/off switch in Settings and an unsubscribe link.
- **Status:** done: every Monday from 06:00 UTC, users with activity last week (Mon–Sun) get a summary per project: team hours and theirs, tasks done, average mood and resistance, with a link to the project. Settings → Emails has an on/off switch, and the email has a one-click unsubscribe link (signed, no sign-in). Each week is sent once; a week not sent by Tuesday 06:00 is skipped.

## Sign-ups by campaign on the admin page

Need to know utm_source so I can tell which marketing strategy works

- **Decision:** table per utm_source and campaign with sign-ups, still active and paying, for the last 30 days and all time; source shown per member too.
- **Status:** done: Admin → Campaigns tab with sign-ups per utm_source and campaign (30 days and all time), how many are active (opened the app in 30 days) and how many pay. Without utm tags the referring site is used, else "(direct)". Invited members and admins are left out. Members tab shows each member's source under the join date.

## Trial-ending emails

- **Decision:** 7 days and 1 day before the trial ends, explaining that projects freeze but nothing is lost.
- **Status:** done: a background job (every 30 minutes) emails trial users when the trial ends within 7 days and again the day before, explaining projects freeze but nothing is lost, with a link to choose a plan. Each reminder is sent once per trial end date, so extended or restarted trials are reminded again; exempt users are skipped. Links use the new `App:BaseUrl` setting (default https://toomanyprojects.fyi).

## "Made with TooManyProjects" link on reports and bills

For visibility and word of mouth

- **Status:** done: "Made with TooManyProjects · toomanyprojects.fyi" at the bottom of every report and bill, linking to the landing page with utm_source=bill, so sign-ups from it show up in the campaign table.

## research integrations

slack, notion, discord

- **Decision:** written notes here: what each could do, effort, upkeep, recommendation. No code.
- **Status:** done: notes below.

### Notes (October 2026)

**Recommendation in one line:** build one small "notifications" feature that posts to a Slack *or* Discord channel through a webhook URL pasted into project settings. Skip a Notion integration for now; the CSV import already covers moving over from Notion.

**Slack**
- *What it could do:* post to a team channel when a task is done, a bill is finalized or paid, someone starts or finishes work (with mood and resistance), and the weekly summary. Later, with a full app: create tasks from a message or a `/tmp` command.
- *Cheap way:* incoming webhooks. The user creates one in Slack and pastes the URL into project settings; we POST a message to it. Send-only, about 1 message per second per URL, no review needed. Still supported when created through a Slack app (only the old "custom integrations" are deprecated).
- *Full way:* a Slack app with OAuth ("Add to Slack"), needed for slash commands, picking channels in our UI, and the Slack Marketplace. Apps for other workspaces are expected to go through Marketplace review, which reportedly takes weeks. Not worth it until users ask for two-way features.
- *Effort/upkeep:* webhook version ~1 day (settings field, a few event hooks, message formatting), almost no upkeep. OAuth app: 1–2 weeks plus review and upkeep.

**Discord**
- *What it could do:* the same one-way notifications as Slack, for teams (indie devs, gaming studios, communities) that live in Discord.
- *How:* channel webhooks work like Slack's: paste a URL, POST JSON (a message plus up to 10 embeds). Rate limit roughly 5 requests per 2 seconds per webhook, so retry on 429 using Retry-After.
- *Effort/upkeep:* nearly free once Slack webhooks exist: the same feature with a second message format.
- *Fit:* weaker than Slack for small agencies and businesses, but costs almost nothing to add alongside.

**Notion**
- *What it could do:* (1) import tasks from a Notion database, (2) show linked Notion pages nicely on tasks, (3) two-way task sync.
- *How:* a public integration with OAuth; the API allows about 3 requests per second on average (429 + Retry-After when exceeded). Notion has added webhooks, but their payloads carry only ids, so every change needs follow-up API calls; details and beta status still need checking against Notion's changelog.
- *Effort/upkeep:* import over the API ~3–5 days; link previews ~1 day; two-way sync weeks of work, plus ongoing upkeep for field mapping, conflicts and rate limits.
- *Advice:* the CSV import already handles Notion's export, so (1) is covered. (3) cuts against "one tool instead of five". Revisit only if feature requests keep naming Notion.

**Suggested order if built:** 1) Slack and Discord webhook notifications per project; 2) Notion page link previews on tasks; 3) anything deeper only on demand (watch Admin → Requests).

**Sources:** [Notion request limits](https://developers.notion.com/reference/request-limits), [Slack app distribution](https://docs.slack.dev/distribution), [Slack incoming webhooks](https://api.slack.com/messaging/webhooks), [Are Slack webhooks deprecated (Svix)](https://www.svix.com/resources/faq/are-slack-webhooks-deprecated/), [Discord webhooks guide (Hookdeck)](https://hookdeck.com/webhooks/platforms/guide-to-discord-webhooks-features-and-best-practices.md).

## Specify pricing

i also want you to specify in the pricing that only the project owner needs to subscribe to a plan, which for a team of 5 works out to less than $1 per month, cheaper than a coffee!

- **Decision:** already on the landing page; add the same note to the in-app plans page.
- **Status:** done: the plans page shows the same owner-pays note above the plan cards.

## Time and task import as CSV

Will need to handle Notion typical csv format, as well as Toggl, Clockify, Harvest

- **Decision:** both, as two commits: tasks (Notion, spreadsheets) and time entries (Toggl, Clockify, Harvest), each with column auto-detection and a preview.
- **Status:** done. Tasks: "Import" on the project board reads a CSV (comma, semicolon or tab; Notion, Asana, Jira, Linear, Trello or a spreadsheet), guesses which column is title, description, status, priority, assignee, due, created and completed, lets you correct that and map each status and priority found, asks the date order when dates are ambiguous, previews, and creates all tasks at once (assignees matched to members by email, username or name). Time entries done: "Import" on the overview's hours table reads Toggl, Clockify and Harvest exports (start/end date and time, or a date plus duration, which then starts at 09:00; decimal commas and "1:30:00" durations), picks this project's rows when the file has several projects, previews, and adds the hours. People are matched by email, username, name or first name; only project owners can import other people's hours. Rows overlapping hours already logged are skipped, so importing a file twice adds nothing.

## Make bills and reports look very nice

Since bills and reports are the single largest source of word of mouth for this project we need to polish them up and make them look very professional

- **Decision:** polished layout plus optional contractor logo, address, org. number and payment details (bank account, payment terms) in billing settings.
- **Status:** done: bills and reports are a white "paper" sheet in any theme: logo, address and org. number top left; bill no., period, issued and due dates top right; bill to; line items with rate; totals; a highlighted amount due with payment details; time details as an appendix. New billing settings: contractor address, org./VAT number, logo, payment details and payment terms (days, default 14). Also fixed: billed days showed a day early east of UTC, and amounts now read "NOK 1,250.00".

## Share bill and report by link with customer

- **Decision:** unguessable read-only link that works without an account; the owner can turn it off at any time.
- **Status:** done: "Share with client" on a bill or report preview creates a secret link (/shared/…) that opens read only without an account; Copy link and Turn off link next to it. A shared preview stays live and updates as work is logged; a shared bill shows it as finalized, with its status.

## VAT on bills

- **Decision:** VAT rate per project, default 0%. Bills show subtotal, VAT and total; 0% hides the VAT line.
- **Status:** done: "VAT %" in billing settings (0–100, default 0). With VAT, the report shows subtotal (excl. VAT), VAT and total, and the finalized bill's amount includes VAT. VAT applies to the month's own work; overdue bills already include theirs.

## CLI + MCP or at least instructions for how to use, can host the CLI tool for easy download and install on the actual website would be nice

- **Decision:** a single-file Node.js CLI hosted on the website (one-line install), signing in with personal access tokens created in Settings; commands for projects, tasks and time tracking. No MCP server for now: an instructions page on the website covers installing and using the CLI.
- **Status:** todo (order 4: tokens, order 5: CLI and instructions)

## Make buckets in board exact width of screen so scrolling to the side can snap the next bucket into view?

Need to think about how this affects dragging tasks around

- **Decision:** phones only: each column fills the screen and swiping snaps to the next. Dragging a card to the screen edge scrolls on (snapping paused while dragging), and cards get a "Move to" control so moving needs no dragging across.
- **Status:** done: on phones (700px and narrower) each column is exactly the board's width and swiping snaps to the next. Dragging pauses the snapping; holding a card within 48px of the edge keeps scrolling that way, and the board snaps to the nearest column once dropped. Each card has a "Move to…" picker on phones (blocked tasks shake, as when dragged). Tablets and desktops are unchanged.

## Add task button not visible without scrolling down on mobile

- **Decision:** a floating + button at the bottom right of the board on phones.
- **Status:** done: on phones (700px and narrower) a round + button stays at the bottom right of the board and opens the New task dialog; it replaces the header's New task button there. Desktop is unchanged.

## Suggest a feature label is not hidden on mobile

Causes ugly horizontal overflow, just hide the text and keep the icon on mobile

- **Status:** done: on phones the button shows only the lightbulb (with the label kept for screen readers and as a tooltip); no more sideways overflow.
