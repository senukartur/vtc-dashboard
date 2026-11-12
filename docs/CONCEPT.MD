# VTC Dashboard — Concept

A web dashboard for the Yukon Union virtual trucking company: a small community (about 10–30 members) of Euro Truck Simulator 2 and American Truck Simulator drivers. It gives the company a public face and a shared workspace for members, dispatchers and administrators. The interface is in Russian and English and works on phone, tablet and desktop.

## How it works

A visitor learns about the company and its public convoys and applies to join. An administrator approves the application and sends an invitation. The new member sets a password, links Steam and starts as a Trainee in each game.

Drivers submit trips through the companion telemetry app or as a manual report with a screenshot. The dashboard keeps the source evidence, recognizes cities, cargo and trailers from game catalogs, checks qualification rules, and accepts, rejects or sends the trip to staff review. Only accepted trips count toward statistics and promotion.

Members browse company and personal stats, driver profiles and trips, RSVP to convoys and get in-app updates. Admins review reports and applications, manage qualifications and members, and confirm promotions and event attendance.

## Roles

- **Trainee** and **Driver**: the same member capabilities; what they may haul is defined by their per-game qualification.
- **Dispatcher**: reviews manual reports and disputed trips.
- **Deputy Director**: the same administration as the Director, except leadership transfer and changes to the Director's account.
- **Director**: exactly one; full administration.

Roles are additive and separate from ETS2/ATS qualifications. Nobody may approve their own manual report.

## Features

- **Public site**: landing page with current-month company totals, public convoys and a membership application (nickname, email, Steam profile, games; Discord and introduction optional).
- **Admissions**: approve, or reject with a reason that is emailed to the applicant; a one-time invitation link valid for seven days, sent by email on staff request or copied for manual delivery.
- **Accounts**: email/password sign-in, linked Steam and basic TruckersMP. Staff replace a Steam link on request with an audit trail. Leaving deactivates the account but keeps its history; a returning member gets the same account without old privileges.
- **Telemetry**: a revocable personal token for durable desktop uploads of all retained trips, then new ones. Private details show job type, game mode (including HaulMP) and recorded Hard Mode result.
- **Manual reports**: game, cities, cargo, mass, trailer, actual distance, reference start and completion, and a screenshot. Damage and depot companies are optional. A different reviewer checks the report. Edits create revisions. Screenshots stay for a year or longer after the latest decision. Over-limit acceptance requires explicit confirmation.
- **Trip history** is searchable by stable number or localized labels. Replays, revisions and overlaps preserve one trip and its credit. Late telemetry changes to confirmed trips need review.
- **Qualifications**: per game Trainee → Driver III → Driver II → Driver I, limiting cargo mass, trailer types and hazardous cargo. Promotion progress counts accepted trips and distance; the Director or a Deputy confirms promotions, and the system never demotes automatically. Telemetry trips use the rules in force at actual start. Manual reports use the rules at staff confirmation.
- **Game catalogs**: per-game ETS2/ATS DLCs, regions, cities, companies, cargo and trailer types as plain editable lists, kept by hand or by CSV/JSON import. Telemetry is matched by exact code. DLCs and companies have one canonical name; other names are RU/EN with a visible English fallback, and a city can also carry its in-game canonical name, shown in the city autocomplete and beside the translated name; hidden rows stay readable but leave new selections. Companies also have city depots, offered in manual reports, and a staff-uploaded logo with a placeholder when missing.
- **Analytics**: accepted trip counts and actual distance for company and driver, in one reporting timezone. Browse recent trips, filter by date, search or follow driver history links.
- **Events**: public and private convoys with RSVP, platform, cities and depots, exact distance and DLC requirements. Members see depot logos and who joins or declines. Decline reasons are private to authors and admins. One-hour reminder and nearest-event quick RSVP in the header and overview. Staff record attendance separately. Confirmed event trips may carry prescribed loads beyond qualification limits.
- **Notifications**: in-app history and updates while the site is open.
- **Workspace attention**: counts and actions by permission.
- **Administration**: members and roles, qualification limits and thresholds, company settings and integrations. Leadership transfer is done only by the serving Director, confirmed with a ten-minute email code.

## Not in the MVP

Import from the old websites, full Trucky/VTCBase integrations, visas, reputation, spendable points, Web Push, custom roles, disciplinary automation and mod support.

## Where details live

- Detailed product rules, permission matrix and acceptance scenarios: [MVP product policies](product/mvp-policies.md).
- Architecture: [overview](architecture/README.md), [stack](decisions/stack.md), [hosting](decisions/hosting.md). Stack: React/Vite SPA and Fastify API on Node.js 24 with MySQL 8.4.
- Telemetry contract: [v1](contracts/telemetry-v1.md). Cards: [Trello](https://trello.com/b/NwhwurSM/vtcdashboard).

## Changing this file

Edit this file only when a feature is added or existing behavior changes. Add or correct one short bullet (one to three sentences) under Features. Put detailed rules in the product policies and technical details in contracts or ADRs. Do not add status, dates, card progress, evidence or logs. Keep the file under 6000 characters (checked by `pnpm test:scaffold`).
