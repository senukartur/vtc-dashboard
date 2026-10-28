# Research and Integration References

These links are inputs for discovery, not a promise of complete data, unchanged API contracts, or free production hosting. Recheck current service terms and costs when implementing the relevant card.

- Existing production site: https://ykn-u.ru/
- Existing test site: https://test.ykn-u.ru/
- Existing qualification examples: https://ykn-u.ru/portal/qualify_driver and https://ykn-u.ru/portal/qualify_3
- UI components: https://github.com/shadcn-ui/ui
- Node.js release lifecycle: https://nodejs.org/en/about/previous-releases — use a supported LTS line and verify available patches; a host form default is not a lifecycle recommendation.
- Drizzle MySQL/mysql2 integration: https://orm.drizzle.team/docs/mysql/get-started-mysql
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- MySQL locking reads and queue considerations: https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html
- MySQL implicit DDL commits: https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html
- Trucky API documentation: https://api.truckyapp.com/docs/
- Trucky city endpoints: https://api.truckyapp.com/v2/map/cities/ets2 and https://api.truckyapp.com/v2/map/cities/ats
- Trucky company API/webhooks: https://truckyapp.com/kb/vtc-hub-api-and-external-drivers-hub-integration/
- VTCBase guide: https://vtcbase.com/guia — the owner confirmed that Discord-documented webhooks can target ordinary services; payload/auth/retry behavior still requires verification.
- TruckersMP API documentation: https://github.com/TruckersMP/Docs
- SCS telemetry SDK: https://modding.scssoft.com/wiki/Documentation/Engine/SDK/Telemetry
- SCS archive extractor: https://modding.scssoft.com/wiki/Documentation/Tools/Game_Archive_Extractor
- SCS cargo definitions: https://modding.scssoft.com/wiki/Documentation/Engine/Units/cargo_data
- SCS trailer/body/chain model: https://modding.scssoft.com/wiki/Games/ETS2/Modding_guides/1.32
- Example game-definition extraction project: https://github.com/AlexOQ/trucker
- Render free-service limitations: https://render.com/docs/free — services can sleep; free databases expire; application files are ephemeral.
- Resend quotas: https://resend.com/docs/knowledge-base/account-quotas-and-limits

The existing sites were inspected with member-level access; their complete administrator interfaces and internal formulas were not verified. Do not treat displayed examples or legacy rules as approved specifications for this implementation.
