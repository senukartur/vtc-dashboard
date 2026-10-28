# VTC Dashboard — Concept

A web dashboard for the Yukon Union virtual trucking company: a small community (about 10–30 members) of Euro Truck Simulator 2 and American Truck Simulator drivers. It gives the company a public face and a shared workspace for members, dispatchers and administrators. The interface is in Russian and English and works on phone, tablet and desktop.

## How it works

A visitor learns about the company and its public convoys and applies to join. An administrator approves the application and sends an invitation. The new member sets a password, links Steam and starts as a Trainee in each game.

Drivers submit trips through the companion telemetry app or as a manual report with a screenshot. The dashboard keeps the source evidence, recognizes cities, cargo and trailers from game catalogs, checks qualification rules, and accepts, rejects or sends the trip to staff review. Only accepted trips count toward statistics and promotion.

Members see company and personal statistics, driver profiles and trip history, sign up for convoys, and get in-app updates while the site is open. Administrators review applications and reports, configure qualifications, confirm promotions and event attendance, and manage members.

## Roles

- **Trainee** and **Driver**: the same member capabilities; what they may haul is defined by their per-game qualification.
- **Dispatcher**: reviews manual reports and disputed trips.
- **Deputy Director**: the same administration as the Director, except leadership transfer and changes to the Director's account.
- **Director**: exactly one; full administration.

Roles are additive and separate from ETS2/ATS qualifications. Nobody may approve their own manual report.

## Features

- **Public site**: landing page, public convoys and a membership application (nickname, email, Steam profile, games; Discord and introduction optional).
- **Admissions**: approve, or reject with a reason that is emailed to the applicant; a one-time invitation link valid for seven days, sent by email or copied for manual delivery.
- **Accounts**: email/password sign-in, linked Steam and basic TruckersMP. Staff replace a Steam link on request with an audit trail. Leaving deactivates the account but keeps its history; a returning member gets the same account without old privileges.
- **Telemetry**: a personal revocable token for the desktop client, which uploads all retained trips on first connection and then new ones. Uploads are durable and retry-safe.
- **Manual reports**: game, cities, cargo, mass, trailer, actual distance and at least one screenshot, without a trip date. Reviewed by someone other than the author; edits and resubmissions create revisions. Screenshots are kept for at least one year after the latest decision.
- **One canonical trip**: replays, revisions and manual/telemetry overlap never duplicate trips, distance or progress. Late telemetry that changes a confirmed result goes to staff review.
- **Qualifications**: per game Trainee → Driver III → Driver II → Driver I, limiting cargo mass, trailer types and hazardous cargo. Promotion progress counts accepted trips and distance; the Director or a Deputy confirms promotions, and the system never demotes automatically. Trips are judged by the rules in force at their actual start; undated manual reports by those at confirmation.
- **Game catalogs**: versioned ETS2/ATS cities, cargo and trailers for the base games and all official DLCs, with IDs independent of RU/EN names and a visible English fallback for missing Russian names. Updates go through review before publication.
- **Analytics**: company and personal totals from accepted trips only, using actual driven distance and one company reporting timezone.
- **Events**: public and private convoys with RSVP. Declining requires a reason visible only to its author and administrators. Reminder one hour before start; the nearest event is shown in the header; attendance is recorded separately from the response. Confirmed event trips may carry the prescribed load beyond qualification limits.
- **Notifications**: in-app history and updates while the site is open.
- **Administration**: members and roles, qualification limits and thresholds, company settings and integrations. Leadership transfer is done only by the serving Director, confirmed with a ten-minute email code.

## Not in the MVP

Import from the old websites, full Trucky/VTCBase integrations, visas, reputation, spendable points, Web Push, custom roles, disciplinary automation and mod support.

## Where details live

- Detailed product rules, permission matrix and acceptance scenarios: [MVP product policies](product/mvp-policies.md).
- Architecture: [overview](architecture/README.md), [stack](decisions/stack.md), [hosting](decisions/hosting.md). Stack: React/Vite SPA and Fastify API on Node.js 24 with MySQL 8.4.
- Telemetry contract: [v1](contracts/telemetry-v1.md). Cards: [Trello](https://trello.com/b/NwhwurSM/vtcdashboard).

## Changing this file

Edit this file only when a feature is added or existing behavior changes. Add or correct one short bullet (one to three sentences) under Features. Put detailed rules in the product policies and technical details in contracts or ADRs. Do not add status, dates, card progress, evidence or logs. Keep the file under 6000 characters (checked by `pnpm test:scaffold`).
