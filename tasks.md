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
- **Status:** todo (order 11)

## Sign-ups by campaign on the admin page

Need to know utm_source so I can tell which marketing strategy works

- **Decision:** table per utm_source and campaign with sign-ups, still active and paying, for the last 30 days and all time; source shown per member too.
- **Status:** done: Admin → Campaigns tab with sign-ups per utm_source and campaign (30 days and all time), how many are active (opened the app in 30 days) and how many pay. Without utm tags the referring site is used, else "(direct)". Invited members and admins are left out. Members tab shows each member's source under the join date.

## Trial-ending emails

- **Decision:** 7 days and 1 day before the trial ends, explaining that projects freeze but nothing is lost.
- **Status:** todo (order 10)

## "Made with TooManyProjects" link on reports and bills

For visibility and word of mouth

- **Status:** done: "Made with TooManyProjects · toomanyprojects.fyi" at the bottom of every report and bill, linking to the landing page with utm_source=bill, so sign-ups from it show up in the campaign table.

## research integrations

slack, notion, discord

- **Decision:** written notes here: what each could do, effort, upkeep, recommendation. No code.
- **Status:** todo (order 14)

## Specify pricing

i also want you to specify in the pricing that only the project owner needs to subscribe to a plan, which for a team of 5 works out to less than $1 per month, cheaper than a coffee!

- **Decision:** already on the landing page; add the same note to the in-app plans page.
- **Status:** done: the plans page shows the same owner-pays note above the plan cards.

## Time and task import as CSV

Will need to handle Notion typical csv format, as well as Toggl, Clockify, Harvest

- **Decision:** both, as two commits: tasks (Notion, spreadsheets) and time entries (Toggl, Clockify, Harvest), each with column auto-detection and a preview.
- **Status:** todo (order 12 and 13)

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
