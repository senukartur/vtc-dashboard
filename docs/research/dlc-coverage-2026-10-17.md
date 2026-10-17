# VTC-002 — Official DLC coverage audit

**Observed:** 2026-10-17. **Games tested:** ETS2 1.61.1.9; ATS 1.61.3.18.

This is an inventory/definition-availability audit, not a published gameplay catalog or a claim of production completeness. The owner approved transferring the three unavailable ATS source gaps to VTC-019, with full coverage still required before launch.

## Result

| Game | Steam-listed DLCs | Released | Upcoming | Released packs with inspected archives | Unavailable sources |
| --- | --- | --- | --- | --- | --- |
| ETS2 | 108 | 103 | 5 | 103 | 0 |
| ATS | 61 | 57 | 4 | 54 | 3 |

All 180 selected local archive path inventories were read successfully (111 ETS2 / 69 ATS), including every local `dlc_*.scs` and six selected base containers per game. Filtered text-definition extraction succeeded for 88 candidate-bearing archives; 92 had no candidate paths for the inspected entity families. Cosmetic files, models, textures and maps were not copied in this expanded audit. Eleven local DLC-style containers are not represented in the public base-app DLC arrays; they are recorded separately together with the twelve selected base containers. Their availability is not a claim about licence ownership or the global existence of all unlisted products.

## Source and evidence boundaries

- Base inventory: [ETS2 Steam DLC page](https://store.steampowered.com/dlc/227300/) and [ATS Steam DLC page](https://store.steampowered.com/dlc/270880/), with public `appdetails` base-app DLC arrays and individual listed-app metadata (`l=english`, `cc=us`). Store metadata can change, vary by region, omit unlisted/free content, or be unavailable. A fixed observed list is not an evergreen inventory or a supported Steam API SLA.
- Every listed app was resolved successfully; the released/upcoming distinction uses the observed Steam `coming_soon` flag. Upcoming products are tracked, not counted as unavailable released sources.
- [Machine-readable evidence](data/official-dlc-baseline-2026-10-17.json) records every listed app, explicit archive association, inspection state and raw candidate-unit counts. The missing-pack archive names are expected associations, not verified depot filenames. Associations for available packs were reviewed using titles and inspected definition paths/content; they are not an authoritative Steam depot/file manifest.
- The independently downloaded [sk-zk/Extractor 2026-07-29](https://github.com/sk-zk/Extractor/releases/tag/2026-07-29) was run as an external GPL-2.0 tool. Its source/binary provenance is pinned in the JSON evidence. It was not incorporated into the project, modified, or redistributed. No deep/raw mode or locale decoding was used.
- Read archive paths, then extract only relevant text definitions with `--partial=/def` and a filter for registry/city/cargo/region/company/trailer-definition/body/chassis files. Raw data and diagnostics remain ignored. SCS extractor results from the initial experiment remain valid; the expanded run uses the separate selective tool.
- Unit counts are a bounded text-pattern inventory. Active registry reachability, SII includes, profile mount/overlay precedence, retired entries and usable English labels remain VTC-019 validation. Zero matched units means no candidates found by this method, not proof that a pack cannot influence gameplay through another mechanism.

## Unavailable released ATS sources

| DLC | Public app | Audit outcome | Required follow-up |
| --- | --- | --- | --- |
| South Dakota | [3749870](https://store.steampowered.com/app/3749870/) | Source unavailable for this audit | Obtain authorized source evidence and validate in VTC-019 before launch |
| Illinois | [3486960](https://store.steampowered.com/app/3486960/) | Source unavailable for this audit | Obtain authorized source evidence and validate in VTC-019 before launch |
| Louisiana | [3012580](https://store.steampowered.com/app/3012580/) | Source unavailable for this audit | Obtain authorized source evidence and validate in VTC-019 before launch |

These packs remain in the approved launch scope. No purchase, installation or entitlement change was made. Do not retire cities or publish a complete-coverage flag based on their missing source data. VTC-019 and VTC-042 must keep the release gate open until the gaps are resolved.

## Findings that affect import design

- Trailer-brand packs can also contribute cargo and factory-city units: Krone and Feldbinder in ETS2 were observed doing both. DLC category labels are insufficient to decide what to import.
- Paint/tuning packs can contain trailer-owned accessory files without adding a trailer definition or body type. Do not turn every accessory into a selectable qualification category.
- The inspected base definitions themselves include seasonal/custom registries and definitions not necessarily reachable in the ordinary job market. Importing every file as an active entity would overstate coverage.
- Some cargo-like files in free ATS truck containers use other unit classes rather than `cargo_data`. File counts and parsed unit-class candidates are therefore different measures.
- The inspected source corpus contains 385 ETS2 / 263 ATS city-unit candidates, 418 / 307 cargo-unit candidates and 514 / 562 trailer-definition candidates. These include base and supplementary containers, and are not approved active catalog sizes. The three missing ATS packs prevent a complete source corpus.

## Per-pack release inventory

Columns C/G/T/B are candidate city/cargo/trailer-definition/trailer-body unit counts in the associated archive, not unique active entities. Other columns and limitations are preserved in the JSON. A dash means the source was not inspected.

### ETS2

| DLC | App | Source archive / release state | Audit | C / G / T / B |
| --- | --- | --- | --- | --- |
| Holland Style Tuning Pack | [4400940](https://store.steampowered.com/app/4400940/) | `dlc_dutch_style.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Bobcat Cargo Pack | [4348650](https://store.steampowered.com/app/4348650/) | `dlc_bobcat.scs` | archive-inspected | 0 / 7 / 0 / 0 |
| Nordic Horizons | [2780810](https://store.steampowered.com/app/2780810/) | `dlc_polar.scs` | archive-inspected | 41 / 0 / 0 / 0 |
| Farm Machinery | [1456860](https://store.steampowered.com/app/1456860/) | `dlc_farm_machinery.scs` | archive-inspected | 0 / 9 / 0 / 0 |
| Forest Machinery | [4159240](https://store.steampowered.com/app/4159240/) | `dlc_forest_harvesting.scs` | archive-inspected | 0 / 8 / 0 / 0 |
| Greece | [2604420](https://store.steampowered.com/app/2604420/) | `dlc_greece.scs` | archive-inspected | 15 / 0 / 0 / 0 |
| DAF XF Electric | [3977520](https://store.steampowered.com/app/3977520/) | `dlc_daf_xf_electric.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Greek Mythology Pack | [3335300](https://store.steampowered.com/app/3335300/) | `dlc_greek_paintjobs.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Volvo FH Series 6 | [3323360](https://store.steampowered.com/app/3323360/) | `dlc_volvo_fh_2024.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Iveco S-Way | [3354860](https://store.steampowered.com/app/3354860/) | `dlc_iveco_sway.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Volvo FH Series 5 | [3323350](https://store.steampowered.com/app/3323350/) | `dlc_volvo_fh_2021.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Kässbohrer Trailer Pack | [3034950](https://store.steampowered.com/app/3034950/) | `dlc_kassbohrer.scs` | archive-inspected | 0 / 0 / 38 / 32 |
| Krone Trailer Pack | [933610](https://store.steampowered.com/app/933610/) | `dlc_krone.scs` | archive-inspected | 1 / 4 / 22 / 20 |
| Kögel Trailer Pack | [3034940](https://store.steampowered.com/app/3034940/) | `dlc_kogel.scs` | archive-inspected | 0 / 0 / 21 / 11 |
| JCB Equipment Pack | [2780800](https://store.steampowered.com/app/2780800/) | `dlc_jcb.scs` | archive-inspected | 0 / 10 / 0 / 0 |
| Scania S BEV | [3035040](https://store.steampowered.com/app/3035040/) | `dlc_scania_s_2024e.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Renault Trucks E-Tech T | [2932420](https://store.steampowered.com/app/2932420/) | `dlc_renault_etech_t.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Modern Lines Paint Jobs Pack | [2579670](https://store.steampowered.com/app/2579670/) | `dlc_lines.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Street Art Paint Jobs Pack | [1967650](https://store.steampowered.com/app/1967650/) | `dlc_streetart.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Ukrainian Paint Jobs Pack | [1918370](https://store.steampowered.com/app/1918370/) | `dlc_flags_ukr.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Renault Trucks T Tuning Pack | [1967640](https://store.steampowered.com/app/1967640/) | `dlc_renault_t_tuning.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Iberia | [1209460](https://store.steampowered.com/app/1209460/) | `dlc_iberia.scs` | archive-inspected | 51 / 0 / 0 / 0 |
| Road to the Black Sea | [1056760](https://store.steampowered.com/app/1056760/) | `dlc_balkan_e.scs` | archive-inspected | 35 / 0 / 0 / 0 |
| Beyond the Baltic Sea | [925580](https://store.steampowered.com/app/925580/) | `dlc_balt.scs` | archive-inspected | 35 / 0 / 0 / 0 |
| Italia | [558244](https://store.steampowered.com/app/558244/) | `dlc_it.scs` | archive-inspected | 22 / 0 / 0 / 0 |
| Vive la France ! | [531130](https://store.steampowered.com/app/531130/) | `dlc_fr.scs` | archive-inspected | 28 / 0 / 0 / 0 |
| Scandinavia | [304212](https://store.steampowered.com/app/304212/) | `dlc_north.scs` | archive-inspected | 29 / 0 / 0 / 0 |
| Going East! | [227310](https://store.steampowered.com/app/227310/) | `dlc_east.scs` | archive-inspected | 16 / 0 / 0 / 0 |
| Special Transport | [558245](https://store.steampowered.com/app/558245/) | `dlc_oversize.scs` | archive-inspected | 0 / 17 / 0 / 0 |
| Volvo Construction Equipment | [1704460](https://store.steampowered.com/app/1704460/) | `dlc_volvo_construction.scs` | archive-inspected | 0 / 7 / 0 / 0 |
| Heavy Cargo Pack | [531131](https://store.steampowered.com/app/531131/) | `dlc_heavy_cargo.scs` | archive-inspected | 0 / 11 / 0 / 0 |
| High Power Cargo Pack | [304214](https://store.steampowered.com/app/304214/) | `dlc_trailers.scs` | archive-inspected | 0 / 8 / 0 / 0 |
| Actros Tuning Pack | [1056761](https://store.steampowered.com/app/1056761/) | `dlc_actros_tuning.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Mighty Griffin Tuning Pack | [461244](https://store.steampowered.com/app/461244/) | `dlc_mighty_griffin.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| FH Tuning Pack | [1299530](https://store.steampowered.com/app/1299530/) | `dlc_volvo_tuning_pack.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| XF Tuning Pack | [461249](https://store.steampowered.com/app/461249/) | `dlc_daf_tuning_pack.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Schwarzmüller Trailer Pack | [388477](https://store.steampowered.com/app/388477/) | `dlc_schwarzmuller.scs` | archive-inspected | 0 / 0 / 5 / 5 |
| Goodyear Tyres Pack | [1117140](https://store.steampowered.com/app/1117140/) | `dlc_goodyear.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Schmitz Cargobull Trailer Pack | [2833100](https://store.steampowered.com/app/2833100/) | `dlc_schmitz.scs` | archive-inspected | 0 / 0 / 47 / 29 |
| HS-Schoch Tuning Pack | [1209461](https://store.steampowered.com/app/1209461/) | `dlc_hs_schoch.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Wheel Tuning Pack | [388475](https://store.steampowered.com/app/388475/) | `dlc_rims.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Cabin Accessories | [388470](https://store.steampowered.com/app/388470/) | `dlc_toys.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Super Stripes Paint Jobs Pack | [1415700](https://store.steampowered.com/app/1415700/) | `dlc_super_stripes.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Raven Truck Design Pack | [318521](https://store.steampowered.com/app/318521/) | `dlc_raven.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Window Flags | [461242](https://store.steampowered.com/app/461242/) | `dlc_phys_flags.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Lunar New Year Pack | [526950](https://store.steampowered.com/app/526950/) | `dlc_lunar_new_year.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Valentine's Paint Jobs Pack | [558243](https://store.steampowered.com/app/558243/) | `dlc_valentine.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Force of Nature Paint Jobs Pack | [292320](https://store.steampowered.com/app/292320/) | `dlc_nature.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Halloween Paint Jobs Pack | [258460](https://store.steampowered.com/app/258460/) | `dlc_halloween.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Ice Cold Paint Jobs Pack | [266930](https://store.steampowered.com/app/266930/) | `dlc_winter.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Christmas Paint Jobs Pack | [318520](https://store.steampowered.com/app/318520/) | `dlc_christmas.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Space Paint Jobs Pack | [925650](https://store.steampowered.com/app/925650/) | `dlc_space.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Pirate Paint Jobs Pack | [461248](https://store.steampowered.com/app/461248/) | `dlc_pirates.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Prehistoric Paint Jobs Pack | [266931](https://store.steampowered.com/app/266931/) | `dlc_prehistoric.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Viking Legends | [347212](https://store.steampowered.com/app/347212/) | `dlc_vikings.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Dragon Truck Design Pack | [558240](https://store.steampowered.com/app/558240/) | `dlc_dragon.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Fantasy Paint Jobs Pack | [304210](https://store.steampowered.com/app/304210/) | `dlc_fantasy.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Metallic Paint Jobs Pack | [297790](https://store.steampowered.com/app/297790/) | `dlc_metallics.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Flip Paint Designs | [301180](https://store.steampowered.com/app/301180/) | `dlc_metallics2.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Czech Paint Jobs Pack | [318511](https://store.steampowered.com/app/318511/) | `dlc_flags_cz.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Slovak Paint Jobs Pack | [461240](https://store.steampowered.com/app/461240/) | `dlc_flags_sk.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Polish Paint Jobs Pack | [304020](https://store.steampowered.com/app/304020/) | `dlc_flags_pl.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| German Paint Jobs Pack | [318500](https://store.steampowered.com/app/318500/) | `dlc_flags_de.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Austrian Paint Jobs Pack | [461243](https://store.steampowered.com/app/461243/) | `dlc_flags_at.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Swiss Paint Jobs Pack | [461246](https://store.steampowered.com/app/461246/) | `dlc_flags_ch.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Hungarian Paint Jobs Pack | [388479](https://store.steampowered.com/app/388479/) | `dlc_flags_hu.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Norwegian Paint Jobs Pack | [347190](https://store.steampowered.com/app/347190/) | `dlc_flags_n.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Swedish Paint Jobs Pack | [347211](https://store.steampowered.com/app/347211/) | `dlc_flags_s.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Finnish Paint Jobs Pack | [540720](https://store.steampowered.com/app/540720/) | `dlc_flags_fi.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Danish Paint Jobs Pack | [347210](https://store.steampowered.com/app/347210/) | `dlc_flags_dk.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Estonian Paint Jobs Pack | [980590](https://store.steampowered.com/app/980590/) | `dlc_flags_ee.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Latvian Paint Jobs Pack | [980591](https://store.steampowered.com/app/980591/) | `dlc_flags_lv.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Lithuanian Paint Jobs Pack | [980592](https://store.steampowered.com/app/980592/) | `dlc_flags_lt.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Michelin Fan Pack | [388471](https://store.steampowered.com/app/388471/) | `dlc_michelin.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Dutch Paint Jobs Pack | [909640](https://store.steampowered.com/app/909640/) | `dlc_flags_nl.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Spanish Paint Jobs Pack | [461241](https://store.steampowered.com/app/461241/) | `dlc_flags_es.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Portuguese Paint Jobs Pack | [876980](https://store.steampowered.com/app/876980/) | `dlc_flags_pt.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| French Paint Jobs Pack | [318510](https://store.steampowered.com/app/318510/) | `dlc_flags_fr.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Italian Paint Jobs Pack | [388476](https://store.steampowered.com/app/388476/) | `dlc_flags_it.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Romanian Paint Jobs Pack | [558241](https://store.steampowered.com/app/558241/) | `dlc_flags_ro.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Bulgarian Paint Jobs  Pack | [1159030](https://store.steampowered.com/app/1159030/) | `dlc_flags_bg.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| UK Paint Jobs Pack | [297791](https://store.steampowered.com/app/297791/) | `dlc_flags_uk.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Irish Paint Jobs Pack | [297792](https://store.steampowered.com/app/297792/) | `dlc_flags_ie.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Scottish Paint Jobs Pack | [297793](https://store.steampowered.com/app/297793/) | `dlc_flags_sc.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Belgian Paint Jobs Pack | [540721](https://store.steampowered.com/app/540721/) | `dlc_flags_be.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Turkish Paint Jobs Pack | [388474](https://store.steampowered.com/app/388474/) | `dlc_flags_tr.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Canadian Paint Jobs Pack | [304213](https://store.steampowered.com/app/304213/) | `dlc_flags_ca.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| USA Paint Jobs Pack | [304211](https://store.steampowered.com/app/304211/) | `dlc_flags_us.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Brazilian Paint Jobs Pack | [304140](https://store.steampowered.com/app/304140/) | `dlc_flags_bz.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Japanese Paint Jobs Pack | [388472](https://store.steampowered.com/app/388472/) | `dlc_flags_jp.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| South Korean Paint Jobs Pack | [461245](https://store.steampowered.com/app/461245/) | `dlc_flags_kr.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Chinese Paint Jobs Pack | [461247](https://store.steampowered.com/app/461247/) | `dlc_flags_cn.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Australian Paint Jobs Pack | [558242](https://store.steampowered.com/app/558242/) | `dlc_flags_aus.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| DAF XG/XG+ | [1650650](https://store.steampowered.com/app/1650650/) | `dlc_daf_2021.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Pink Ribbon Charity Pack | [1068290](https://store.steampowered.com/app/1068290/) | `dlc_pink_ribbon.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| West Balkans | [2004210](https://store.steampowered.com/app/2004210/) | `dlc_balkan_w.scs` | archive-inspected | 30 / 0 / 0 / 0 |
| Feldbinder Trailer Pack | [2193220](https://store.steampowered.com/app/2193220/) | `dlc_feldbinder.scs` | archive-inspected | 1 / 4 / 23 / 14 |
| Heart of Russia | [1536500](https://store.steampowered.com/app/1536500/) | upcoming | future-release | — |
| MAN TGX | [2371170](https://store.steampowered.com/app/2371170/) | `dlc_man_tgx_2020.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Wielton Trailer Pack | [2455690](https://store.steampowered.com/app/2455690/) | `dlc_wielton.scs` | archive-inspected | 0 / 0 / 25 / 15 |
| TIRSAN Trailer Pack | [2569750](https://store.steampowered.com/app/2569750/) | `dlc_tirsan.scs` | archive-inspected | 0 / 0 / 13 / 11 |
| DAF XD | [2611740](https://store.steampowered.com/app/2611740/) | `dlc_daf_xd.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Russian Paint Jobs Pack | [347213](https://store.steampowered.com/app/347213/) | `dlc_flags_ru.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Iceland | [3796990](https://store.steampowered.com/app/3796990/) | upcoming | future-release | — |
| Coaches | [3809270](https://store.steampowered.com/app/3809270/) | upcoming | future-release | — |
| Isle of Ireland | [3851260](https://store.steampowered.com/app/3851260/) | upcoming | future-release | — |
| KRONE Agriculture Equipment | [3872920](https://store.steampowered.com/app/3872920/) | `dlc_krone_agriculture.scs` | archive-inspected | 0 / 7 / 0 / 0 |
| Soul of Anatolia | [4400930](https://store.steampowered.com/app/4400930/) | upcoming | future-release | — |

### ATS

| DLC | App | Source archive / release state | Audit | C / G / T / B |
| --- | --- | --- | --- | --- |
| Road Trip: Ford | [3793200](https://store.steampowered.com/app/3793200/) | `dlc_rt_ford.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| South Dakota | [3749870](https://store.steampowered.com/app/3749870/) | `dlc_sd.scs` | archive-unavailable | — |
| Illinois | [3486960](https://store.steampowered.com/app/3486960/) | `dlc_il.scs` | archive-unavailable | — |
| Bobcat Cargo Pack | [4348660](https://store.steampowered.com/app/4348660/) | `dlc_bobcat.scs` | archive-inspected | 0 / 7 / 0 / 0 |
| Louisiana | [3012580](https://store.steampowered.com/app/3012580/) | `dlc_la.scs` | archive-unavailable | — |
| Iowa | [3025440](https://store.steampowered.com/app/3025440/) | `dlc_ia.scs` | archive-inspected | 12 / 0 / 0 / 0 |
| Missouri | [2730870](https://store.steampowered.com/app/2730870/) | `dlc_mo.scs` | archive-inspected | 12 / 0 / 0 / 0 |
| Arkansas | [2585150](https://store.steampowered.com/app/2585150/) | `dlc_ar.scs` | archive-inspected | 10 / 0 / 0 / 0 |
| Nebraska | [2543810](https://store.steampowered.com/app/2543810/) | `dlc_ne.scs` | archive-inspected | 12 / 0 / 0 / 0 |
| JCB Equipment Pack | [2926440](https://store.steampowered.com/app/2926440/) | `dlc_jcb.scs` | archive-inspected | 0 / 10 / 0 / 0 |
| Sports Paint Jobs Pack | [2910160](https://store.steampowered.com/app/2910160/) | `dlc_sports.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Kenworth T680 2022 | [2720080](https://store.steampowered.com/app/2720080/) | `dlc_kenworth_t680_2022.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Michelin Fan Pack | [2675870](https://store.steampowered.com/app/2675870/) | `dlc_michelin.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Farm Machinery | [2638630](https://store.steampowered.com/app/2638630/) | `dlc_farm_machinery.scs` | archive-inspected | 0 / 10 / 0 / 0 |
| Kansas | [2298430](https://store.steampowered.com/app/2298430/) | `dlc_ks.scs` | archive-inspected | 14 / 0 / 0 / 0 |
| Oklahoma | [2209650](https://store.steampowered.com/app/2209650/) | `dlc_ok.scs` | archive-inspected | 10 / 0 / 0 / 0 |
| W900 Tuning Pack | [2386530](https://store.steampowered.com/app/2386530/) | `dlc_w900_tuning.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Texas | [1465750](https://store.steampowered.com/app/1465750/) | `dlc_tx.scs` | archive-inspected | 30 / 0 / 0 / 0 |
| Lode King & Prestige Trailers Pack | [1967690](https://store.steampowered.com/app/1967690/) | `dlc_lodeking.scs` | archive-inspected | 0 / 0 / 194 / 89 |
| Montana | [1811080](https://store.steampowered.com/app/1811080/) | `dlc_mt.scs` | archive-inspected | 15 / 0 / 0 / 0 |
| Wyoming | [1415692](https://store.steampowered.com/app/1415692/) | `dlc_wy.scs` | archive-inspected | 11 / 0 / 0 / 0 |
| Colorado | [1209471](https://store.steampowered.com/app/1209471/) | `dlc_co.scs` | archive-inspected | 13 / 0 / 0 / 0 |
| Idaho | [1209470](https://store.steampowered.com/app/1209470/) | `dlc_id.scs` | archive-inspected | 11 / 0 / 0 / 0 |
| Utah | [1104880](https://store.steampowered.com/app/1104880/) | `dlc_ut.scs` | archive-inspected | 10 / 0 / 0 / 0 |
| Washington | [1015160](https://store.steampowered.com/app/1015160/) | `dlc_wa.scs` | archive-inspected | 16 / 0 / 0 / 0 |
| Oregon | [800370](https://store.steampowered.com/app/800370/) | `dlc_or.scs` | archive-inspected | 14 / 0 / 0 / 0 |
| New Mexico | [684630](https://store.steampowered.com/app/684630/) | `dlc_nm.scs` | archive-inspected | 16 / 0 / 0 / 0 |
| Cabin Accessories | [1477840](https://store.steampowered.com/app/1477840/) | `dlc_toys.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Special Transport | [962750](https://store.steampowered.com/app/962750/) | `dlc_oversize.scs` | archive-inspected | 0 / 16 / 0 / 0 |
| Forest Machinery | [1076080](https://store.steampowered.com/app/1076080/) | `dlc_forest_harvesting.scs` | archive-inspected | 0 / 9 / 0 / 0 |
| Volvo Construction Equipment | [1662380](https://store.steampowered.com/app/1662380/) | `dlc_volvo_construction.scs` | archive-inspected | 0 / 7 / 0 / 0 |
| Heavy Cargo Pack | [620610](https://store.steampowered.com/app/620610/) | `dlc_heavy_cargo.scs` | archive-inspected | 0 / 13 / 0 / 0 |
| Wheel Tuning Pack | [450550](https://store.steampowered.com/app/450550/) | `dlc_rims.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Goodyear Tires Pack | [1621740](https://store.steampowered.com/app/1621740/) | `dlc_goodyear.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Steering Creations Pack | [520550](https://store.steampowered.com/app/520550/) | `dlc_sci_st_wheels.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Dragon Truck Design Pack | [561620](https://store.steampowered.com/app/561620/) | `dlc_dragon.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Retrowave Paint Jobs Pack | [1784890](https://store.steampowered.com/app/1784890/) | `dlc_neon.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Space Paint Jobs Pack | [1116310](https://store.steampowered.com/app/1116310/) | `dlc_space.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Classic Stripes Paint Jobs Pack | [951650](https://store.steampowered.com/app/951650/) | `dlc_stripes.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Steampunk Paint Jobs Pack | [432710](https://store.steampowered.com/app/432710/) | `dlc_steampunk.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Valentine's Paint Jobs Pack | [588600](https://store.steampowered.com/app/588600/) | `dlc_valentine.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Halloween Paint Jobs Pack | [546260](https://store.steampowered.com/app/546260/) | `dlc_halloween.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Christmas Paint Jobs Pack | [566890](https://store.steampowered.com/app/566890/) | `dlc_christmas.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Arizona | [463740](https://store.steampowered.com/app/463740/) | `dlc_arizona.scs` | archive-inspected | 18 / 0 / 0 / 0 |
| Freightliner Cascadia® (3rd/4th Generation) | [1415690](https://store.steampowered.com/app/1415690/) | `dlc_freightliner_cascadia2019.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| International LT® | [1708620](https://store.steampowered.com/app/1708620/) | `dlc_international_lt.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| International® 9900i | [1915840](https://store.steampowered.com/app/1915840/) | `dlc_international_9900i.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Mack Anthem® | [1236650](https://store.steampowered.com/app/1236650/) | `dlc_mack_anthem.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Western Star® 49X | [1415691](https://store.steampowered.com/app/1415691/) | `dlc_westernstar_49x.scs` | archive-inspected | 0 / 1 / 0 / 0 |
| Western Star® 57X | [2093200](https://store.steampowered.com/app/2093200/) | `dlc_westernstar_57x.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Pink Ribbon Charity Pack | [1162160](https://store.steampowered.com/app/1162160/) | `dlc_pink_ribbon.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Wild West Paint Jobs Pack | [2187930](https://store.steampowered.com/app/2187930/) | `dlc_western.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Western Star® 5700XE | [2257950](https://store.steampowered.com/app/2257950/) | `dlc_westernstar_5700xe.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Volvo VNL 2018 | [2386480](https://store.steampowered.com/app/2386480/) | `dlc_volvo_vnl2018.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Mack® Pinnacle | [3146090](https://store.steampowered.com/app/3146090/) | `dlc_mack_pinnacle.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Freightliner Cascadia® (The Fifth Generation) | [3272290](https://store.steampowered.com/app/3272290/) | `dlc_freightliner_cascadia2024.scs` | archive-inspected | 0 / 0 / 0 / 0 |
| Road Trip: RAM & Dodge | [3793190](https://store.steampowered.com/app/3793190/) | upcoming | future-release | — |
| KRONE Agriculture Equipment | [3872930](https://store.steampowered.com/app/3872930/) | `dlc_krone_agriculture.scs` | archive-inspected | 0 / 7 / 0 / 0 |
| British Columbia | [4057480](https://store.steampowered.com/app/4057480/) | upcoming | future-release | — |
| North Dakota | [4400790](https://store.steampowered.com/app/4400790/) | upcoming | future-release | — |
| Indiana | [4400800](https://store.steampowered.com/app/4400800/) | upcoming | future-release | — |

## Supplementary containers

These were inspected in addition to the public base-app DLC lists. This table does not assign store identities or assert licence ownership.

| Game | Archive | Raw unit candidates |
| --- | --- | --- |
| ETS2 | `base.scs` | None matched |
| ETS2 | `base_cfg.scs` | None matched |
| ETS2 | `base_map.scs` | None matched |
| ETS2 | `base_share.scs` | None matched |
| ETS2 | `base_vehicle.scs` | None matched |
| ETS2 | `def.scs` | trailerBody: 68, trailerDefinition: 320, region: 37, company: 138, city: 81, cargo: 326 |
| ETS2 | `dlc_pcg.scs` | None matched |
| ETS2 | `dlc_rocket_league.scs` | None matched |
| ATS | `base.scs` | None matched |
| ATS | `base_cfg.scs` | None matched |
| ATS | `base_map.scs` | None matched |
| ATS | `base_share.scs` | None matched |
| ATS | `base_vehicle.scs` | None matched |
| ATS | `def.scs` | trailerBody: 97, trailerDefinition: 368, region: 22, company: 218, city: 29, cargo: 225 |
| ATS | `dlc_international_lonestar.scs` | None matched |
| ATS | `dlc_kenworth_t680.scs` | cargo: 1 |
| ATS | `dlc_kenworth_w900.scs` | None matched |
| ATS | `dlc_nevada.scs` | city: 10 |
| ATS | `dlc_peterbilt_389.scs` | None matched |
| ATS | `dlc_peterbilt_579.scs` | cargo: 1 |
| ATS | `dlc_volvo_vnl.scs` | None matched |
| ATS | `dlc_volvo_vnl2025.scs` | None matched |
| ATS | `dlc_volvo_vnr_e.scs` | None matched |

## Delivery and hand-off

See the [catalog investigation](catalogs.md) for the approved translation/update model and source-reuse questions. VTC-002 can deliver this discovery result with explicit downstream gaps; it does not deliver production catalog implementation. Review and merged PR evidence are still required before the card moves to Done.
