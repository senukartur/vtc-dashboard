# VTC Dashboard — Concept

A web dashboard for the Yukon Union virtual trucking company: a small community (about 10–30 members) of Euro Truck Simulator 2 and American Truck Simulator drivers. It gives the company a public face and a shared workspace for members, dispatchers and administrators. The RU/EN interface works on phone, tablet and desktop.

## How it works

A visitor learns about the company and public convoys and applies to join. An administrator approves the application and sends an invitation. The new member sets a password, links Steam and starts as a Trainee in each game.

Drivers submit trips via the companion telemetry app or a manual report with a screenshot. The dashboard keeps source evidence, recognizes cities, cargo and trailers from game catalogs, checks the driver's level limits, and accepts, rejects or sends the trip to staff review. Only accepted trips count toward statistics and promotion.

Members browse company and personal stats, driver profiles and trips, RSVP to convoys and get in-app updates. Admins review reports and applications, manage qualifications and members, and confirm event attendance.

## Roles

- **Trainee** and **Driver**: the same member capabilities; their per-game qualification defines what they may haul.
- **Dispatcher**: reviews manual reports and disputed trips.
- **Deputy Director**: Director-level administration, except leadership transfer and changes to the Director's account.
- **Director**: exactly one; full administration.

Roles are additive and separate from ETS2/ATS qualifications. Nobody may approve their own manual report.

## Features

- **Public site**: landing page with current-month company totals, public convoys and a membership application (nickname, email, Steam profile, games; Discord, introduction and referral source optional).
- **Admissions**: approve, or reject with a reason emailed to the applicant; a one-time seven-day invitation link, emailed on staff request or copied for manual delivery. Applicants are checked on TruckersMP.
- **Accounts**: email/password sign-in with Remember me, linked Steam and basic TruckersMP. Staff replace Steam links on request and log the change. Leaving deactivates the account. Returning members keep account and history; privileges are reassigned.
- **Telemetry**: a revocable personal token for durable desktop uploads of all retained trips, then new ones. Private details show job type, game mode (including HaulMP) and recorded Hard Mode result.
- **Manual reports**: game, cities, cargo, mass, trailer, actual distance, reference start and completion, and a screenshot. Damage and depot companies are optional. A different reviewer checks the report. Edits create revisions. Screenshots stay at least a year after the latest decision. Over-limit acceptance needs explicit confirmation.
- **Trip history** is searchable by stable number or localized labels. Replays, revisions and overlaps preserve one trip and its credit. Late telemetry changes to confirmed trips need review.
- **Qualifications**: one page per game with up to 25 levels. Each level limits cargo mass, distance, trailer types, ADR and Hard Mode, and sets trip and distance conditions. New members start at the first level; meeting the conditions promotes automatically. The Director or a Deputy edits the ladder and can change a member's level. The level at actual start (telemetry) or staff confirmation (manual reports) applies.
- **Game catalogs**: per-game DLCs, regions, cities, companies, cargo and trailer variants, edited or imported; telemetry keeps exact body codes; new selections and allowances use assigned trailer types, preserving legacy allowances and history. Regions use verified base presence or a reviewed primary DLC; cities keep expansion sources. DLCs/companies use canonical names; other labels use RU/EN with marked English fallback and native city names; hidden rows stay readable; companies have city depots and staff-uploaded logos or placeholders.
- **Analytics**: accepted trips and actual distance for company and driver in one reporting timezone, by range or all time, with leaderboard positions, top routes, cargo and trip sources. Recent trips: date filter, search and driver history links.
- **Events**: staff draft and publish public or private convoys with platform, cities, depots, exact distance, DLCs and galleries with covers. Members see depot logos and RSVPs. Only authors and admins see decline reasons. One-hour reminders and nearest-event quick RSVP in the header and overview. Staff record actual attendance. Confirmed event trips are credited without the level limits.
- **Notifications**: in-app history and updates while the site is open; per-kind toggles, own accepted trips, new events.
- **Workspace attention**: counts by permission.
- **Administration**: members, roles, qualification levels, company settings, integrations and a filterable audit log. The serving Director transfers leadership with a ten-minute email code.

## Not in the MVP

Import from the old websites, full Trucky/VTCBase integrations, visas, reputation, spendable points, Web Push, custom roles, disciplinary automation and mod support.

## Where details live

- Product rules, permission matrix and acceptance scenarios: [MVP product policies](product/mvp-policies.md).
- Architecture: [overview](architecture/README.md), [stack](decisions/stack.md), [hosting](decisions/hosting.md). Stack: React/Vite SPA and Fastify API on Node.js 24 with MySQL 8.4.
- Telemetry contract: [v1](contracts/telemetry-v1.md). Cards: [Trello](https://trello.com/b/NwhwurSM/vtcdashboard).

## Changing this file

Edit this file only when a feature is added or behavior changes. Add or correct one short bullet (one to three sentences) under Features. Put detailed rules in the product policies and technical details in contracts or ADRs. Do not add status, dates, card progress, evidence or logs. Keep the file under 6000 characters (checked by `pnpm test:scaffold`).
