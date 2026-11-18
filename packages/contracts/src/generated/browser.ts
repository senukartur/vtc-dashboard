// Generated from the reviewed OpenAPI. Do not edit by hand.
export interface paths {
    "/api/v1/admin/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listApplications
         * @description Optional statusCounts are calculated within the authorized population before pagination. Each bucket uses its own status predicate and the other applicable list filters.
         */
        get: operations["listApplications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/applications/{applicationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getApplication */
        get: operations["getApplication"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/applications/{applicationId}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** decideApplication */
        post: operations["decideApplication"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/applications/{applicationId}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List retained applications for the same normalized email */
        get: operations["listApplicationHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/applications/{applicationId}/truckersmp-checks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Recheck the applicant on TruckersMP
         * @description Bodyless command. Requires current applications.manage, exact Origin, session-bound CSRF and a UUID Idempotency-Key; no If-Match. Starts a new check generation and returns 202 with state checking; while a check is already running the current check is returned unchanged. A Steam /id/ vanity link returns 409 STATE_CONFLICT. A missing provider adapter returns 503. An identical retry rechecks current authority and returns the recorded result.
         */
        post: operations["recheckApplicationTruckersmp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listAudit */
        get: operations["listAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/{list}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** createCatalogItem */
        post: operations["createCatalogItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/{list}/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** updateCatalogItem */
        patch: operations["updateCatalogItem"];
        trace?: never;
    };
    "/api/v1/admin/catalogs/{list}/import-previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * previewCatalogImport
         * @description Dry-run of one CSV or JSON file (8 MiB). Writes nothing. The returned token authorizes applying exactly these bytes by this actor for 30 minutes and is null when any line has an error. For depots, lines name the company code; companies, cities and DLCs are referenced by (game, code).
         */
        post: operations["previewCatalogImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/{list}/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * applyCatalogImport
         * @description Revalidates the same file and applies it in one transaction. Upserts by (game, code); an empty optional cell keeps the stored value, so import cannot clear a value.
         */
        post: operations["applyCatalogImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/companies/{id}/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * uploadCatalogCompanyLogo
         * @description Stores or replaces the company's logo. One PNG up to 32 KiB, at most 128x32 pixels, checked on the server. The original bytes are kept.
         */
        put: operations["uploadCatalogCompanyLogo"];
        post?: never;
        /**
         * removeCatalogCompanyLogo
         * @description Removes the logo. Removing a logo that is not there changes nothing and writes no audit entry.
         */
        delete: operations["removeCatalogCompanyLogo"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/companies/logo-imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * applyCatalogLogos
         * @description Revalidates every file and stores all logos in one transaction or none. Identical bytes count as unchanged.
         */
        post: operations["applyCatalogLogos"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/companies/logo-previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * previewCatalogLogos
         * @description Dry-run of up to 500 PNG files named <company code>.png (16 MiB). line is the file's 1-based position in the upload; issues name the field file (bad_name, not_png, too_large, bad_dimensions, corrupt, duplicate_in_file) or code (unknown_reference). The token binds this actor, the game and the exact files and is null when any file has an error.
         */
        post: operations["previewCatalogLogos"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/depots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** createCatalogDepot */
        post: operations["createCatalogDepot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalogs/depots/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** updateCatalogDepot */
        patch: operations["updateCatalogDepot"];
        trace?: never;
    };
    "/api/v1/admin/company-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCompanySettings */
        get: operations["getCompanySettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** updateCompanySettings */
        patch: operations["updateCompanySettings"];
        trace?: never;
    };
    "/api/v1/admin/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listAdminEvents
         * @description Only event managers can filter draft or published events. The default filter is published; cursors are scoped to the filter and authority.
         */
        get: operations["listAdminEvents"];
        put?: never;
        /** createEvent */
        post: operations["createEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * deleteEventDraft
         * @description Discard an active draft and fence its media.
         */
        delete: operations["deleteEventDraft"];
        options?: never;
        head?: never;
        /** updateEvent */
        patch: operations["updateEvent"];
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}/attendance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getEventAttendance */
        get: operations["getEventAttendance"];
        /** setEventAttendance */
        put: operations["setEventAttendance"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}/cancellation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** cancelEvent */
        post: operations["cancelEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listAdminEventMedia
         * @description Read media metadata for an accessible draft or published event. The ETag belongs to the media collection.
         */
        get: operations["listAdminEventMedia"];
        put?: never;
        /**
         * uploadEventMedia
         * @description Upload one image under the media collection ETag and a key scoped to the actor and event. Retry the same file and request under the same key. Up to ten images may occupy slots in an event.
         */
        post: operations["uploadEventMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}/media/{mediaId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * deleteEventMedia
         * @description Remove a media item under the media collection ETag. Removal of the cover clears it.
         */
        delete: operations["deleteEventMedia"];
        options?: never;
        head?: never;
        /**
         * updateEventMedia
         * @description Edit the caption, position or cover under the media collection ETag.
         */
        patch: operations["updateEventMedia"];
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}/nonresponders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listEventNonresponders
         * @description Current leaders may page eligible members with no current participation or decline response.
         */
        get: operations["listEventNonresponders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/events/{eventId}/publication": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * publishEventDraft
         * @description Validate the saved draft as a complete event and publish under the same event ID. Publication is the first notification-eligible change.
         */
        post: operations["publishEventDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/events/drafts/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getEventDraft
         * @description Read an active draft under its independent draft version.
         */
        get: operations["getEventDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * updateEventDraft
         * @description Save an incomplete draft under the draft ETag.
         */
        patch: operations["updateEventDraft"];
        trace?: never;
    };
    "/api/v1/admin/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List current invitations
         * @description Current invitation generation per approved application. active: unused, active state and expiresAt after now (the invited counter definition), ordered by expiresAt ascending then ID. expired: unused, active state and expiresAt at or before now, ordered by expiresAt descending then ID. total counts the selected state before paging. Signed cursors bind the actor, session, access epoch and state; mismatches return 409 VERSION_CONFLICT. Never returns the link, token, secret hash or ciphertext.
         */
        get: operations["listInvitations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/invitations/{invitationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getInvitation */
        get: operations["getInvitation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/invitations/{invitationId}/copy-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** copyInvitation */
        post: operations["copyInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/invitations/{invitationId}/email-deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request first email for the current invitation generation */
        post: operations["requestInvitationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/invitations/{invitationId}/reissue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** reissueInvitation */
        post: operations["reissueInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/leadership/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the serving director's usable pending transfer code and when a new code may be requested */
        get: operations["getLeadershipChallengeState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/leadership/challenges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** requestLeadershipChallenge */
        post: operations["requestLeadershipChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/leadership/transfers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** confirmLeadershipTransfer */
        post: operations["confirmLeadershipTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listAdminMembers
         * @description Optional statusCounts are calculated before cursor and limit. Use the per-counter status, role, search and source rules. Omit each unavailable source-dependent count independently.
         */
        get: operations["listAdminMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getAdminMember */
        get: operations["getAdminMember"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/deactivation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** deactivateMember */
        post: operations["deactivateMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/identity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getAdminMemberIdentity */
        get: operations["getAdminMemberIdentity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/membership": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** setMembership */
        put: operations["setMembership"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/qualifications/{game}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change a member's level manually
         * @description Moves an active member to any active level of the game, up or down, with a required reason. Progress on the new level starts from zero.
         */
        put: operations["changeMemberQualification"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/reinstatement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** reinstateMember */
        post: operations["reinstateMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** setRoles */
        put: operations["setRoles"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/steam-replacement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** replaceSteam */
        post: operations["replaceSteam"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/steam-replacement-verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listSteamReplacementProofs */
        get: operations["listSteamReplacementProofs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/steam-replacement-verifications/{verificationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getSteamReplacementProof */
        get: operations["getSteamReplacementProof"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/qualification-levels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a level at a position
         * @description Inserts the level at the position (1..active count + 1) and shifts later levels down, then promotes drivers who already meet their level's conditions. 409 when the game already has 25 active levels.
         */
        post: operations["createQualificationLevel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/qualification-levels/{levelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Edit a level's name, limits and conditions
         * @description Limits apply to trips decided from now on; decided trips keep their stored check. Drivers who already meet lowered conditions are promoted in the same transaction. 409 VERSION_CONFLICT on a stale expectedVersion.
         */
        put: operations["updateQualificationLevel"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/qualification-levels/{levelId}/position": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Move a level to another position
         * @description Re-numbers the game's ladder and promotes drivers who meet their conditions.
         */
        put: operations["moveQualificationLevel"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/qualification-levels/{levelId}/removal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Remove a level and transfer its drivers
         * @description Soft-deletes the level, moves its current drivers to the active transfer level of the same game and closes the position gap. The last active level cannot be removed.
         */
        post: operations["removeQualificationLevel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/reinstatement-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read explicit per-game return choices */
        get: operations["getReinstatementOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/source-capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getSourceCapabilities */
        get: operations["getSourceCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/source-connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listSourceConnections */
        get: operations["listSourceConnections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/source-connections/{connectionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getSourceConnection */
        get: operations["getSourceConnection"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** updateSourceConnection */
        patch: operations["updateSourceConnection"];
        trace?: never;
    };
    "/api/v1/analytics/company": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getCompanyAnalytics
         * @description period=all_time uses month granularity in the company reporting time zone. fromDate is the first day of the month of the earliest accepted unique trip that matches the filters, and toDateExclusive is the first day of the month after the current month. Without such a trip fromDate is the first day of the current month. granularity=day returns 422 with it. Buckets are zero-filled for every month of the covered range, so a company without accepted trips returns one zero bucket. activeDrivers counts distinct members with at least one accepted trip in the period; activeMembers counts active memberships of any role at computedAt; byGame lists ets2 then ats with zeros, or only the filtered game.
         */
        get: operations["getCompanyAnalytics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analytics/company/breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Company analytics breakdown
         * @description Same access, setup errors and filters as getCompanyAnalytics over accepted unique canonical trips in the company reporting time zone. route groups by canonical origin and destination city IDs; A to B and B to A are separate routes. cargo groups by canonical cargo ID. Rows with an unresolved city or cargo are excluded from items and counted in undetermined. Items rank by accepted trips descending, then actual distance descending, then IDs; trips beyond limit are counted in remainder. source splits by the provider of the effective fact (derived facts use their source message) and always returns ets2telemetry and manual; limit is rejected with 422 for source. Labels use locale or the saved locale and keep hidden catalog entries with hidden true. period=all_time covers the same month-aligned range as getCompanyAnalytics: fromDate is the first day of the month of the earliest accepted unique trip that matches the filters, and toDateExclusive is the first day of the month after the current month. Without such a trip fromDate is the first day of the current month.
         */
        get: operations["getCompanyAnalyticsBreakdown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analytics/leaderboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getLeaderboard
         * @description Order and ties are unchanged: actual distance descending, accepted trips descending, then member ID. position is the 1-based ordinal under that order. The signed cursor also binds period. period=all_time covers the same month-aligned range as getCompanyAnalytics, without buckets: fromDate is the first day of the month of the earliest accepted unique trip that matches the filters, and toDateExclusive is the first day of the month after the current month. Without such a trip fromDate is the first day of the current month.
         */
        get: operations["getLeaderboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/csrf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCsrf */
        get: operations["getCsrf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** login */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** logout */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-reset-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** requestPasswordReset */
        post: operations["requestPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password-resets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** resetPassword */
        post: operations["resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/{list}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listCatalogItems
         * @description Apply visibility and filters before paging. The normalized filters are bound into the cursor.
         */
        get: operations["listCatalogItems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/{list}/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogItem */
        get: operations["getCatalogItem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/companies/{id}/logo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getCatalogCompanyLogo
         * @description Authenticated read with company.read on every request. The UI requests it only when the item has a logo; a company without one answers 404.
         */
        get: operations["getCatalogCompanyLogo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/depots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listCatalogDepots
         * @description Company and city depots of one game. companyId lists the cities of a company (ordered by city name), cityId the companies in a city, both narrow to one depot; otherwise ordered by the company's canonical name. With cityId a search matches the company name or code; with only companyId it matches the city names or code; otherwise any of them. Rows hidden by the depot, its company or its city are excluded unless includeHidden is true. Explicit hidden=only selects the depot's own hidden flag and takes precedence over includeHidden. Apply filters before paging and bind them into the cursor.
         */
        get: operations["listCatalogDepots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogSummary */
        get: operations["getCatalogSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listEvents */
        get: operations["listEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getEvent */
        get: operations["getEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/decliners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listEventDecliners */
        get: operations["listEventDecliners"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listEventMedia
         * @description Return ready images for an accessible published event.
         */
        get: operations["listEventMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/media/{mediaId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getEventMediaContent
         * @description Members can read ready images on an accessible published event. A current manager may also read ready draft images.
         */
        get: operations["getEventMediaContent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/my-response": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getEventResponse */
        get: operations["getEventResponse"];
        /** setEventResponse */
        put: operations["setEventResponse"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/participants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listEventParticipants */
        get: operations["listEventParticipants"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/events/{eventId}/response-counts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getEventResponseCounts */
        get: operations["getEventResponseCounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * uploadEvidence
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        post: operations["uploadEvidence"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evidence/{evidenceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getEvidence
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getEvidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evidence/{evidenceId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * downloadEvidence
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["downloadEvidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mail-deliveries/{deliveryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read safe delivery evidence */
        get: operations["getMailDelivery"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/mail-deliveries/{deliveryId}/resends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry a known rejected delivery without replacing its generation */
        post: operations["resendMailDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/manual-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * submitManualReport
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate. VTC-117 stages this request shape for later activation. The current implementation continues to use the legacy request schema.
         */
        post: operations["submitManualReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/manual-reports/{reportId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getManualReport
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getManualReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/manual-reports/{reportId}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listManualReportRevisions
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["listManualReportRevisions"];
        put?: never;
        /**
         * reviseManualReport
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate. VTC-117 stages this request shape for later activation. The current implementation continues to use the legacy request schema.
         */
        post: operations["reviseManualReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/manual-reports/{reportId}/revisions/{revisionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getManualReportRevision
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getManualReportRevision"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/manual-trips": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * submitManualTrip
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        post: operations["submitManualTrip"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getMe */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/connection-capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getPersonalConnectionCapabilities */
        get: operations["getPersonalConnectionCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/credential-challenges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** requestCredentialChallenge */
        post: operations["requestCredentialChallenge"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/credential-changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** confirmCredentialChange */
        post: operations["confirmCredentialChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/email-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read current pending email replacement; null when absent, expired, consumed or invalidated */
        get: operations["getPendingEmailChange"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/email-change-confirmations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the separately delivered proposed-address proof and atomically replace email */
        post: operations["confirmProposedEmailChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/email-verification-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** requestEmailVerification */
        post: operations["requestEmailVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/email-verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** confirmEmailVerification */
        post: operations["confirmEmailVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/identity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getIdentity */
        get: operations["getIdentity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/manual-drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listMyManualDrafts
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate. Optional state=editing narrows the owner's list. Optional editingCount counts the owner's editing drafts before cursor pagination. Optional locale chooses the label language; omission uses the account locale.
         */
        get: operations["listMyManualDrafts"];
        put?: never;
        /**
         * createManualDraft
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate. VTC-117 stages this request shape for later activation. The current implementation continues to use the legacy request schema.
         */
        post: operations["createManualDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/manual-drafts/{draftId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getMyManualDraft
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getMyManualDraft"];
        /**
         * replaceManualDraft
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate. VTC-117 stages this request shape for later activation. The current implementation continues to use the legacy request schema.
         */
        put: operations["replaceManualDraft"];
        post?: never;
        /**
         * Delete an editing manual draft
         * @description Bodyless command. Authorize the current actor and validate the editing state and version under lock. Return the stored command data with the current HTTP request ID for an authorized exact retry. Release the draft's attachment references under the existing evidence retention policy. Physical file deletion remains governed by that policy. All responses use Cache-Control: no-store.
         */
        delete: operations["deleteManualDraft"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/manual-drafts/{draftId}/submission": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * submitManualDraft
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate. VTC-117 stages this request shape for later activation. The current implementation continues to use the legacy request schema.
         */
        post: operations["submitManualDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/manual-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listMyManualReports
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["listMyManualReports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notification-preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getNotificationPreferences */
        get: operations["getNotificationPreferences"];
        /** setNotificationPreferences */
        put: operations["setNotificationPreferences"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** updatePreferences */
        patch: operations["updatePreferences"];
        trace?: never;
    };
    "/api/v1/me/qualifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the current member's qualifications
         * @description One item per game in which the member has a current level.
         */
        get: operations["listMyQualifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/source-sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getSourceSync */
        get: operations["getSourceSync"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/steam-replacement-verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** requestSteamReplacementProof */
        post: operations["requestSteamReplacementProof"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/steam-replacement-verifications/{verificationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getMySteamReplacementProof */
        get: operations["getMySteamReplacementProof"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/steam-verifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** requestSteamVerification */
        post: operations["requestSteamVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/telemetry-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listTelemetryTokens */
        get: operations["listTelemetryTokens"];
        put?: never;
        /** issueTelemetryToken */
        post: operations["issueTelemetryToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/telemetry-tokens/{tokenId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** revokeTelemetryToken */
        delete: operations["revokeTelemetryToken"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/trip-status-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getMyTripStatusSummary */
        get: operations["getMyTripStatusSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/upcoming-event": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getUpcomingEvent */
        get: operations["getUpcomingEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/upload-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getUploadPolicy
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getUploadPolicy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/workspace-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the current member's workspace summary
         * @description Apply source availability and current capabilities, visibility and ownership at computedAt. Count eligible rows before limiting each deterministically sorted preview to five items. All responses use Cache-Control: no-store.
         */
        get: operations["getMyWorkspaceSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listMembers
         * @description Company member directory. Filters and the optional nickname search apply before paging. Omitted sort keeps ascending member ID order; each sort is a stable keyset on (sort value, member ID). Signed cursors bind the actor, session, access epoch, normalized filters including status, sort, order and windowEndsAt; mismatches return 409 VERSION_CONFLICT. last30Days counts accepted canonical trips whose reportingAt lies in [windowEndsAt - 30 days, windowEndsAt], including zeros. statusCounts are company-wide totals that ignore every filter and are read in the page's transaction. With Qualifications each row's levels holds its current level per game, null without a current assignment, for a former member and for a level no longer on the active ladder; levels is absent without Qualifications.
         */
        get: operations["listMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getMember */
        get: operations["getMember"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{memberId}/analytics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getMemberAnalytics */
        get: operations["getMemberAnalytics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/members/{memberId}/qualifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a member's qualifications
         * @description One item per game in which the member has a current level.
         */
        get: operations["listMemberQualifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** pollNotifications */
        get: operations["pollNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{notificationId}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** markNotificationRead */
        post: operations["markNotificationRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listNotificationHistory */
        get: operations["listNotificationHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** markNotificationsReadThrough */
        post: operations["markNotificationsReadThrough"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** submitApplication */
        post: operations["submitApplication"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/company": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getPublicCompany */
        get: operations["getPublicCompany"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/company-stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getPublicCompanyStats
         * @description VTC-052 anonymous landing summary. Accepts no query parameters (unknown parameters return 422). Never reads or sets cookies; uses the public read rate limit. Successful responses may be shared-cached for 60 seconds and repeat meta.requestId; no ETag. currentMonth is unavailable (never zero) when no valid reporting timezone is configured.
         */
        get: operations["getPublicCompanyStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listPublicEvents */
        get: operations["listPublicEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getPublicEvent */
        get: operations["getPublicEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/events/{eventId}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getPublicEventCover
         * @description Return the selected ready cover thumbnail only while the published event is public. Recheck visibility for each request.
         */
        get: operations["getPublicEventCover"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/invitation-redemptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** redeemInvitation */
        post: operations["redeemInvitation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/qualification-levels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the active levels of one game's ladder
         * @description Active levels ordered by position with limits, conditions, next level and current driver count, plus the viewer's own qualification in the game.
         */
        get: operations["listQualificationLevels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/qualification-levels/{levelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one active level
         * @description Drivers currently on the level with their credited progress; change history only for qualifications.manage. A removed level is 404.
         */
        get: operations["getQualificationLevel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reconciliation-candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listReconciliationCandidates */
        get: operations["listReconciliationCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reconciliation-candidates/{candidateId}/dismissal-reversals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Undo the current reconciliation candidate dismissal
         * @description Require current trips.review and exclude the reviewer's own trips before filtering, counts, keyset paging or commands. Verify both trip versions and the candidate and dismissal state in the command transaction. The If-Match value versions this candidate's dismissal state; a new snapshot has its own identity and initial version. A dismissal never applies to a different snapshot. The private reason is not in audit or candidate projections. Before the first dismissal the implicit version is 1. The first stored dismissal returns version 2 and undo advances it. An identical retry rechecks current authority and returns the stored result and its ETag even after dismissal state changes. Reusing the key with a different fingerprint returns 409 IDEMPOTENCY_CONFLICT.
         */
        post: operations["undoReconciliationCandidateDismissal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reconciliation-candidates/{candidateId}/dismissals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dismiss the current reconciliation candidate snapshot
         * @description Require current trips.review and exclude the reviewer's own trips before filtering, counts, keyset paging or commands. Verify both trip versions and the candidate and dismissal state in the command transaction. The If-Match value versions this candidate's dismissal state; a new snapshot has its own identity and initial version. A dismissal never applies to a different snapshot. The private reason is not in audit or candidate projections. Before the first dismissal the implicit version is 1. The first stored dismissal returns version 2 and undo advances it. An identical retry rechecks current authority and returns the stored result and its ETag even after dismissal state changes. Reusing the key with a different fingerprint returns 409 IDEMPOTENCY_CONFLICT.
         */
        post: operations["dismissReconciliationCandidate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reconciliations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** reconcileTrips */
        post: operations["reconcileTrips"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reconciliations/{reconciliationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getReconciliation */
        get: operations["getReconciliation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reconciliations/{reconciliationId}/reversals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** reverseReconciliation */
        post: operations["reverseReconciliation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listTrips
         * @description Apply authorized visibility and all supplied filters before counting or paging. When filtering for another owner, return only accepted trips within the caller's authorized scope. After VTC-115 activation, every successful mine or company page includes total for the authorized filtered set before cursor and limit, including with ownerId. The default scope is company. An empty filtered set has total 0. Review pages may omit total. Signed cursors bind the normalized filters, effective locale and order; a mismatch returns 409 VERSION_CONFLICT.
         */
        get: operations["listTrips"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getTrip */
        get: operations["getTrip"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/correction-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listTripCorrectionRequests
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["listTripCorrectionRequests"];
        put?: never;
        /**
         * requestTripCorrection
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        post: operations["requestTripCorrection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/correction-requests/{requestId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getTripCorrectionRequest
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getTripCorrectionRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** decideTrip */
        post: operations["decideTrip"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/event-association": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** associateTripEvent */
        post: operations["associateTripEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/manual-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listTripManualReports
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["listTripManualReports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/manual-revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * listManualRevisions
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["listManualRevisions"];
        put?: never;
        /**
         * reviseManualTrip
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        post: operations["reviseManualTrip"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/manual-revisions/{revisionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * getManualRevision
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["getManualRevision"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listTripProposals */
        get: operations["listTripProposals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/proposals/{proposalId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getTripProposal */
        get: operations["getTripProposal"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/proposals/{proposalId}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** decideTripProposal */
        post: operations["decideTripProposal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/reconciliations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read bounded reconciliation history for the current canonical group */
        get: operations["listTripReconciliations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/resolution-proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** proposeTripResolution */
        post: operations["proposeTripResolution"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/{tripId}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getTripReview */
        get: operations["getTripReview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/trips/review-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the waiting review and duplicate totals
         * @description Require current trips.review and exclude the reviewer's own trips before filtering, counts, keyset paging or commands. Count waiting held canonical roots and actionable duplicate candidates in the selected game, or in both games when omitted. Oldest fields are null when no waiting trip matches; age is elapsed whole seconds at computedAt.
         */
        get: operations["getTripReviewSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Acknowledged: {
            /** @constant */
            status: "received";
        };
        AdminApplicationStatusCounts: {
            approved: number;
            rejected: number;
            submitted: number;
        };
        /** @description Counts use current authorized populations before cursor and limit. Identity counts are available independently of optional sources. Omit each source-dependent count independently when its source is configured off or read authority is absent. Return zero for available empty counts. Transient read failures follow the standard error policy. */
        AdminMemberStatusCounts: {
            /** @description Requires enabled Trips activity reads and current authority to read that activity. Count distinct members matching the supplied status, role and nickname search with accepted canonical trip reportingAt in the inclusive interval from the count snapshot time minus 30 days through the snapshot time. Consider both statuses when the status filter is omitted. */
            droveLast30Days?: number;
            /** @description Active members matching the supplied role and nickname search, replacing any supplied status filter with active. */
            inCompany: number;
            /** @description Requires applications.manage and enabled Admissions reads. Count each approved application's current usable, active and unused invitation generation when its expiry is after the count snapshot time. Apply the same trimmed case-insensitive nickname substring search to the application nickname independently of the member status filter. A supplied role filter yields zero because unredeemed invitations have no current member role. */
            invited?: number;
            /** @description Inactive members matching the supplied role and nickname search, replacing any supplied status filter with inactive. */
            left: number;
        };
        Analytics: {
            acceptedTrips: number;
            actualDistanceM: string;
            buckets: {
                acceptedTrips: number;
                actualDistanceM: string;
                /** Format: date */
                date: string;
            }[];
            /** Format: date-time */
            computedAt: string;
            /** Format: date */
            fromDate: string;
            /** @enum {string} */
            granularity: "day" | "month";
            projectionPending: boolean;
            projectionVersion: number;
            reportingTimezone: string;
            /** Format: date */
            toDateExclusive: string;
        };
        /** @description Top routes, top cargo or the source split of accepted unique canonical trips. Invariant: the sum of items plus remainder plus undetermined equals totals, and totals equal getCompanyAnalytics for the same filters. */
        AnalyticsStage4Breakdown: components["schemas"]["AnalyticsStage4RouteBreakdown"] | components["schemas"]["AnalyticsStage4CargoBreakdown"] | components["schemas"]["AnalyticsStage4SourceBreakdown"];
        AnalyticsStage4BreakdownEnvelope: {
            data: components["schemas"]["AnalyticsStage4Breakdown"];
            meta: components["schemas"]["Meta"];
        };
        AnalyticsStage4CargoBreakdown: {
            computedAt: components["schemas"]["Timestamp"];
            /** @constant */
            dimension: "cargo";
            /** Format: date */
            fromDate: string;
            game: components["schemas"]["Game"] | null;
            items: components["schemas"]["AnalyticsStage4CargoItem"][];
            limit: number;
            /** @enum {string} */
            period: "range" | "all_time";
            projectionPending: boolean;
            projectionVersion: number;
            remainder: components["schemas"]["AnalyticsStage4Totals"];
            reportingTimezone: string;
            /** Format: date */
            toDateExclusive: string;
            totals: components["schemas"]["AnalyticsStage4Totals"];
            undetermined: components["schemas"]["AnalyticsStage4Totals"];
        };
        AnalyticsStage4CargoItem: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
            cargo: components["schemas"]["CatalogLabel"];
            game: components["schemas"]["Game"];
        };
        /** @description Company analytics with optional Stage 4 aggregates. Once VTC-143 activates them each is always returned; absence means not available, never zero. */
        AnalyticsStage4Company: {
            acceptedTrips: number;
            /** @description Distinct members with at least one accepted canonical trip in the period, including former members. Equals the leaderboard rankedMembers for the same period and filters, so it can exceed activeMembers. */
            activeDrivers?: number;
            /** @description Active memberships of any role at computedAt. */
            activeMembers?: number;
            actualDistanceM: string;
            buckets: {
                acceptedTrips: number;
                actualDistanceM: string;
                /** Format: date */
                date: string;
            }[];
            /** @description ets2 then ats including zeros; only the filtered game when game is set. */
            byGame?: components["schemas"]["AnalyticsStage4GameTotals"][];
            /** Format: date-time */
            computedAt: string;
            /** Format: date */
            fromDate: string;
            /** @enum {string} */
            granularity: "day" | "month";
            /** @enum {string} */
            period?: "range" | "all_time";
            projectionPending: boolean;
            projectionVersion: number;
            reportingTimezone: string;
            /** Format: date */
            toDateExclusive: string;
        };
        AnalyticsStage4CompanyEnvelope: {
            data: components["schemas"]["AnalyticsStage4Company"];
            meta: components["schemas"]["Meta"];
        };
        AnalyticsStage4GameTotals: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
            game: components["schemas"]["Game"];
        };
        /** @description The viewer's own ranked row, returned also when it is not on this page. */
        AnalyticsStage4LeaderboardViewer: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
            position: number;
        };
        AnalyticsStage4RouteBreakdown: {
            computedAt: components["schemas"]["Timestamp"];
            /** @constant */
            dimension: "route";
            /** Format: date */
            fromDate: string;
            game: components["schemas"]["Game"] | null;
            items: components["schemas"]["AnalyticsStage4RouteItem"][];
            limit: number;
            /** @enum {string} */
            period: "range" | "all_time";
            projectionPending: boolean;
            projectionVersion: number;
            remainder: components["schemas"]["AnalyticsStage4Totals"];
            reportingTimezone: string;
            /** Format: date */
            toDateExclusive: string;
            totals: components["schemas"]["AnalyticsStage4Totals"];
            undetermined: components["schemas"]["AnalyticsStage4Totals"];
        };
        AnalyticsStage4RouteItem: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
            destination: components["schemas"]["CatalogLabel"];
            game: components["schemas"]["Game"];
            origin: components["schemas"]["CatalogLabel"];
        };
        AnalyticsStage4SourceBreakdown: {
            computedAt: components["schemas"]["Timestamp"];
            /** @constant */
            dimension: "source";
            /** Format: date */
            fromDate: string;
            game: components["schemas"]["Game"] | null;
            /** @description ets2telemetry then manual, including zeros. */
            items: components["schemas"]["AnalyticsStage4SourceItem"][];
            /** @enum {string} */
            period: "range" | "all_time";
            projectionPending: boolean;
            projectionVersion: number;
            remainder: components["schemas"]["AnalyticsStage4Totals"];
            reportingTimezone: string;
            /** Format: date */
            toDateExclusive: string;
            totals: components["schemas"]["AnalyticsStage4Totals"];
            undetermined: components["schemas"]["AnalyticsStage4Totals"];
        };
        AnalyticsStage4SourceItem: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
            /** @enum {string} */
            source: "ets2telemetry" | "manual";
        };
        /** @description Accepted unique canonical trips and their exact actual distance in metres. Zero is a computed zero; an unavailable value is an absent property, never zero. */
        AnalyticsStage4Totals: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
        };
        Application: {
            decision: components["schemas"]["ApplicationDecision"] | null;
            decisionReason: string | null;
            fields: components["schemas"]["ApplicationInput"];
            /** Format: uuid */
            id: string;
            invitationId: string | null;
            /** @enum {string} */
            status: "submitted" | "approved" | "rejected";
            /** Format: date-time */
            submittedAt: string;
            truckersmpCheck?: components["schemas"]["ApplicationStage4TruckersmpCheck"];
            version: number;
        };
        ApplicationDecision: {
            applicationVersion: number;
            /** Format: date-time */
            decidedAt: string;
            deliveryId: string | null;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            outcome: "approve" | "reject";
            reason: string | null;
            /** Format: uuid */
            reviewerId: string;
        };
        ApplicationDecisionInput: {
            /** @constant */
            decision: "approve";
        } | {
            /** @constant */
            decision: "reject";
            reason: string;
        };
        ApplicationInput: {
            discord?: string | null;
            /** Format: email */
            email: string;
            games: ("ets2" | "ats")[];
            introduction?: string | null;
            nickname: string;
            /** @description Free text, only with referralSource other. Without referralSource or with any other source the request returns 422. */
            referralOther?: string;
            /**
             * @description Optional answer to how the applicant found the company.
             * @enum {string}
             */
            referralSource?: "truckersmp" | "discord" | "friend_or_member" | "youtube_or_twitch" | "other";
            /** Format: uri */
            steamProfileUrl: string;
        };
        /** @description The applicant's TruckersMP check, visible only with applications.manage. not_checked covers Steam /id/ vanity links. Successful absence (found false), no VTC and provider failure stay distinct. Never contains the raw provider payload. */
        ApplicationStage4TruckersmpCheck: {
            bans: {
                any: boolean;
                count: number;
            } | null;
            checkedAt: components["schemas"]["Timestamp"] | null;
            displayName: string | null;
            failure: ("transport" | "timeout" | "rate_limited" | "unavailable" | "invalid_response") | null;
            found: boolean | null;
            lastAttemptAt: components["schemas"]["Timestamp"] | null;
            notCheckedReason: ("steam_vanity_url" | "not_requested") | null;
            playerId: string | null;
            profileUrl: string | null;
            /** @enum {string} */
            state: "checking" | "completed" | "not_checked" | "failed";
            vtc: {
                id: string | null;
                inVtc: boolean;
                name: string | null;
                tag: string | null;
            } | null;
        };
        ApplicationStage4TruckersmpCheckEnvelope: {
            data: components["schemas"]["ApplicationStage4TruckersmpCheck"];
            meta: components["schemas"]["Meta"];
        };
        Assignment: {
            /** Format: date-time */
            assignedAt: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            levelId: string;
            /** Format: uuid */
            periodId: string;
        };
        AssignmentHistory: {
            /** Format: date-time */
            assignedAt: string;
            endedAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            levelId: string;
            levelName: string;
            /** Format: uuid */
            periodId: string;
        };
        AssignmentInput: {
            game: components["schemas"]["Game"];
            levelId: components["schemas"]["Id"];
            /** @enum {string} */
            purpose: "initial" | "reinstatement";
            reason: string;
        };
        Attendance: {
            /** @enum {string} */
            attendance: "unconfirmed" | "attended" | "not_attended";
            member: components["schemas"]["MemberSummary"];
            note: string | null;
            response: components["schemas"]["Rsvp"];
        };
        AttendanceInput: {
            members: {
                /** @enum {string} */
                attendance: "attended" | "not_attended";
                /** Format: uuid */
                memberId: string;
                note: string | null;
            }[];
        };
        AuditEntry: {
            action: string;
            actorId: string | null;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3ApplicationEntry: {
            /** @enum {string} */
            action: "application.submitted" | "application.reviewed";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3ApplicationSnapshot"] | null;
                before: components["schemas"]["AuditStage3ApplicationSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3ApplicationSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "application";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3ApplicationSnapshot: {
            /** @enum {string} */
            status: "submitted" | "approved" | "rejected";
        };
        AuditStage3AssignmentEntry: {
            /** @enum {string} */
            action: "qualification.assigned" | "qualification.promoted";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3AssignmentSnapshot"] | null;
                before: components["schemas"]["AuditStage3AssignmentSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3AssignmentSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "qualification";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3AssignmentSnapshot: {
            assignmentId: components["schemas"]["Id"];
            game: components["schemas"]["Game"];
            levelId: components["schemas"]["Id"];
        };
        AuditStage3CompanySettingsEntry: {
            /** @enum {string} */
            action: "configuration.changed";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3CompanySettingsSnapshot"] | null;
                before: components["schemas"]["AuditStage3CompanySettingsSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3CompanySettingsSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "company";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3CompanySettingsSnapshot: {
            reportingTimezone: string | null;
        };
        AuditStage3DuplicateEntry: {
            /** @enum {string} */
            action: "duplicate.dismissed" | "duplicate.dismissal_undone";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3DuplicateSnapshot"] | null;
                before: components["schemas"]["AuditStage3DuplicateSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3DuplicateSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "duplicate_candidate";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3DuplicateSnapshot: {
            dismissed: boolean;
            version: number;
        };
        AuditStage3Entry: components["schemas"]["AuditStage3LegacyEntry"] | components["schemas"]["AuditStage3CompanySettingsEntry"] | components["schemas"]["AuditStage3RolesEntry"] | components["schemas"]["AuditStage3MembershipEntry"] | components["schemas"]["AuditStage3LeadershipEntry"] | components["schemas"]["AuditStage3ApplicationEntry"] | components["schemas"]["AuditStage3InvitationEntry"] | components["schemas"]["AuditStage3TripDecisionEntry"] | components["schemas"]["AuditStage3ReconciliationEntry"] | components["schemas"]["AuditStage3DuplicateEntry"] | components["schemas"]["AuditStage3AssignmentEntry"] | components["schemas"]["AuditStage3LevelEntry"] | components["schemas"]["AuditStage3RulesEntry"];
        AuditStage3InvitationEntry: {
            /** @enum {string} */
            action: "invitation.reissued" | "invitation.copied" | "invitation.redeemed";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3InvitationSnapshot"] | null;
                before: components["schemas"]["AuditStage3InvitationSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3InvitationSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "invitation";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3InvitationSnapshot: {
            /** @enum {string} */
            state: "active" | "used" | "revoked";
        };
        AuditStage3LeadershipEntry: {
            /** @enum {string} */
            action: "leadership.transferred";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3LeadershipSnapshot"] | null;
                before: components["schemas"]["AuditStage3LeadershipSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3LeadershipSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "user";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3LeadershipSnapshot: {
            director: boolean;
        };
        AuditStage3LegacyEntry: {
            action: string;
            actorId: string | null;
            actorNickname: string | null;
            details: null;
            /** Format: uuid */
            id: string;
            objectName: string | null;
            objectType: components["schemas"]["AuditStage3ObjectType"];
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3LevelEntry: {
            /** @enum {string} */
            action: "qualification.level_changed";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3LevelSnapshot"] | null;
                before: components["schemas"]["AuditStage3LevelSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3LevelSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "qualification_level";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3LevelSnapshot: {
            active: boolean;
            game: components["schemas"]["Game"];
            levelId: components["schemas"]["Id"];
            position: number;
            version: number;
        };
        AuditStage3List: {
            items: components["schemas"]["AuditStage3Entry"][];
            nextCursor: string | null;
            total?: number;
        };
        AuditStage3ListEnvelope: {
            data: components["schemas"]["AuditStage3List"];
            meta: components["schemas"]["Meta"];
        };
        AuditStage3MembershipEntry: {
            /** @enum {string} */
            action: "membership.changed";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3MembershipSnapshot"] | null;
                before: components["schemas"]["AuditStage3MembershipSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3MembershipSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "user";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3MembershipSnapshot: {
            role: ("trainee" | "driver") | null;
            /** @enum {string} */
            status: "active" | "inactive";
        };
        /** @enum {string} */
        AuditStage3ObjectType: "company" | "user" | "trip" | "catalog" | "application" | "invitation" | "qualification" | "event" | "duplicate_candidate" | "qualification_level" | "qualification_rule_version";
        AuditStage3ReconciliationEntry: {
            /** @enum {string} */
            action: "trip.reconciled";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3ReconciliationSnapshot"] | null;
                before: components["schemas"]["AuditStage3ReconciliationSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3ReconciliationSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "trip";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3ReconciliationSnapshot: {
            reconciliationId: components["schemas"]["Id"];
            /** @enum {string} */
            state: "applied" | "reversed";
        };
        AuditStage3RolesEntry: {
            /** @enum {string} */
            action: "roles.changed";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3RolesSnapshot"] | null;
                before: components["schemas"]["AuditStage3RolesSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3RolesSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "user";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3RolesSnapshot: {
            roles: ("trainee" | "driver" | "dispatcher" | "deputy_director")[];
        };
        AuditStage3RulesEntry: {
            /** @enum {string} */
            action: "qualification.rules_published";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3RulesSnapshot"] | null;
                before: components["schemas"]["AuditStage3RulesSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3RulesSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "qualification_rule_version";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3RulesSnapshot: {
            game: components["schemas"]["Game"];
            levelId: components["schemas"]["Id"];
            ruleVersionId: components["schemas"]["Id"];
            version: number;
        };
        AuditStage3TripDecisionEntry: {
            /** @enum {string} */
            action: "report.reviewed" | "report.accepted_over_limits";
            actorId: string | null;
            actorNickname: string | null;
            details: {
                after: components["schemas"]["AuditStage3TripDecisionSnapshot"] | null;
                before: components["schemas"]["AuditStage3TripDecisionSnapshot"];
            } | {
                after: components["schemas"]["AuditStage3TripDecisionSnapshot"];
                before: null;
            };
            /** Format: uuid */
            id: string;
            objectName: string | null;
            /** @constant */
            objectType: "trip";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            subjectId: string;
        };
        AuditStage3TripDecisionSnapshot: {
            acceptedOverLimits: boolean;
            /** @enum {string} */
            decision: "unassessed" | "pending_review" | "accepted" | "rejected";
        };
        CatalogCargoInput: {
            adrClass?: ("1" | "2" | "3" | "4" | "6" | "8") | null;
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            dlcId?: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
            nameRu?: string | null;
        };
        CatalogCityInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            dlcId?: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
            nameNative?: string | null;
            nameRu?: string | null;
            regionId?: string | null;
        };
        CatalogCompanyInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            dlcId?: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
        };
        /** @description A company operating in a city. hidden is the depot's own flag; the company and city labels carry theirs. A depot is listed by default only when all three are visible. The company label is the company's canonical name. */
        CatalogDepot: {
            city: components["schemas"]["CatalogDepotCity"];
            company: components["schemas"]["CatalogDepotCompany"];
            dlc: components["schemas"]["CatalogLabel"] | null;
            dlcId: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            hidden: boolean;
            /** Format: uuid */
            id: string;
            /** @description Last update to the depot row itself. */
            updatedAt?: components["schemas"]["Timestamp"];
        };
        CatalogDepotCity: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            /** Format: uuid */
            id: string;
            label: components["schemas"]["CatalogLabel"];
        };
        CatalogDepotCompany: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            /** Format: uuid */
            id: string;
            label: components["schemas"]["CatalogLabel"];
            logo: components["schemas"]["CatalogLogo"] | null;
        };
        CatalogDepotInput: {
            /** Format: uuid */
            cityId: string;
            /** Format: uuid */
            companyId: string;
            dlcId?: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
        };
        CatalogDepotList: {
            items: components["schemas"]["CatalogDepot"][];
            nextCursor: string | null;
            total: number;
        };
        /** @description Partial edit of one depot. game, company and city are immutable. */
        CatalogDepotPatch: {
            dlcId?: string | null;
            hidden?: boolean;
        };
        CatalogDlcInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
            steamAppId?: number | null;
        };
        CatalogImportIssue: {
            field: string;
            reason: string;
        };
        /** @description line is the physical CSV line (header is line 1) or the 1-based JSON array index. */
        CatalogImportLine: {
            changedFields: string[];
            code: string | null;
            issues: components["schemas"]["CatalogImportIssue"][];
            line: number;
            /** @enum {string} */
            status: "error" | "changed";
        };
        CatalogImportPreview: {
            added: number;
            changed: number;
            errors: number;
            fileSha256: string;
            lines: components["schemas"]["CatalogImportLine"][];
            rows: number;
            token: string | null;
            truncated: boolean;
            unchanged: number;
        };
        CatalogImportResult: {
            added: number;
            changed: number;
            /** Format: uuid */
            importId: string;
            rows: number;
            unchanged: number;
        };
        /** @description One row of a catalog list. steamAppId is present only on dlcs, regionId and region only on cities, adrClass only on cargoes, logo (null without an uploaded image) only on companies. On the trailers list, code is the telemetry body type. DLC and company labels always show the canonical name. */
        CatalogItem: {
            adrClass?: ("1" | "2" | "3" | "4" | "6" | "8") | null;
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            /** @description Exact game trailer unit shared by body-type variants. Null leaves the row ungrouped. Trailer lists contain one representative per game and common trailer; original IDs and codes remain recognized. */
            commonTrailer?: string | null;
            /** @description Companies list only. Count linked same-game depots. */
            depotCount?: number;
            display: components["schemas"]["CatalogLabel"];
            dlc: components["schemas"]["CatalogLabel"] | null;
            dlcId: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            hidden: boolean;
            /** Format: uuid */
            id: string;
            logo?: components["schemas"]["CatalogLogo"] | null;
            nameEn: string;
            /** @description The city's canonical name. Present only on the cities list. */
            nameNative?: string | null;
            /** @description Always null on the dlcs and companies lists, which use only their canonical name; a stored Russian name is kept but never returned. */
            nameRu: string | null;
            region?: components["schemas"]["CatalogLabel"] | null;
            regionId?: string | null;
            steamAppId?: number | null;
            /** @description Last update to this catalog row. */
            updatedAt?: components["schemas"]["Timestamp"];
            /** @description Number of stored body-type variants in this trailer group, including hidden variants. */
            variantCount?: number;
        };
        CatalogItemList: {
            items: components["schemas"]["CatalogItem"][];
            nextCursor: string | null;
            total: number;
        };
        /** @description Partial edit of one row. game is immutable. A field that does not exist on the list is rejected. Hide and restore are `{hidden}`. */
        CatalogItemPatch: {
            adrClass?: ("1" | "2" | "3" | "4" | "6" | "8") | null;
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code?: string;
            /** @description Exact game trailer unit shared by body-type variants. Null leaves the row ungrouped. Trailer lists contain one representative per game and common trailer; original IDs and codes remain recognized. */
            commonTrailer?: string | null;
            dlcId?: string | null;
            hidden?: boolean;
            nameEn?: string;
            nameNative?: string | null;
            /** @description Rejected on the dlcs and companies lists. */
            nameRu?: string | null;
            regionId?: string | null;
            steamAppId?: number | null;
        };
        CatalogLabel: {
            /** @description True when a requested Russian name is missing and English is shown. Always false on DLC and company labels, which use only their canonical name. */
            englishFallback: boolean;
            /** Format: uuid */
            entityId: string;
            hidden: boolean;
            label: string;
            /** @description The city's name as the game map writes it. Present only on a city that has one and absent on every other label. Display only, never an identity key. */
            nameNative?: string;
            /** @enum {string} */
            renderedLocale: "en" | "ru";
            /** @enum {string} */
            requestedLocale: "en" | "ru";
        };
        /** @description Present only when the company has a logo. version changes whenever the stored image changes and is passed as ?v= to the logo route. */
        CatalogLogo: {
            byteLength: number;
            version: string;
        };
        /** @description Up to 500 PNG files named <company code>.png; each is checked on its own. */
        CatalogLogoBatchInput: {
            file: string[];
        };
        CatalogRegionInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            dlcId?: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
            nameRu?: string | null;
        };
        CatalogSummary: {
            /** @enum {string} */
            game: "ets2" | "ats";
            lists: {
                cargoes: {
                    hidden: number;
                    /** @description Default-visible rows in this game missing a Russian name. */
                    untranslated?: number;
                    visible: number;
                };
                cities: {
                    hidden: number;
                    /** @description Default-visible rows in this game missing a Russian name. */
                    untranslated?: number;
                    visible: number;
                };
                companies: {
                    hidden: number;
                    /** @description Default-visible companies in this game without a logo. */
                    missingLogo?: number;
                    visible: number;
                };
                depots: {
                    hidden: number;
                    visible: number;
                };
                dlcs: {
                    hidden: number;
                    visible: number;
                };
                regions: {
                    hidden: number;
                    /** @description Default-visible rows in this game missing a Russian name. */
                    untranslated?: number;
                    visible: number;
                };
                trailers: {
                    hidden: number;
                    /** @description Default-visible rows in this game missing a Russian name. */
                    untranslated?: number;
                    visible: number;
                };
            };
        };
        CatalogTrailerInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            /** @description Exact game trailer unit shared by body-type variants. Null leaves the row ungrouped. Trailer lists contain one representative per game and common trailer; original IDs and codes remain recognized. */
            commonTrailer?: string | null;
            dlcId?: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
            nameRu?: string | null;
        };
        Challenge: {
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state: "pending" | "sent" | "expired";
        };
        CommandResult: {
            /** Format: uuid */
            id: string;
            version: number;
        };
        CompanyPublic: {
            description: string;
            games: ("ets2" | "ats")[];
            name: string;
        };
        CompanySettings: {
            /** Format: uuid */
            id: string;
            launchReady: boolean;
            missingSetup: string[];
            reportingTimezone: string | null;
            version: number;
        };
        CompanySettingsInput: {
            reportingTimezone: string;
        };
        CompanyStatsPublic: {
            activeMembers: number;
            /** Format: date-time */
            computedAt: string;
            currentMonth: {
                acceptedTrips: number;
                actualDistanceM: string;
                /** Format: date */
                fromDate: string;
                games: ("ets2" | "ats")[];
                month: string;
                reportingTimezone: string;
                /** @constant */
                status: "available";
                /** Format: date */
                toDateExclusive: string;
            } | {
                /** @enum {string} */
                reason: "company_reporting_timezone";
                /** @constant */
                status: "unavailable";
            };
        };
        CredentialChallengeInput: {
            /** Format: email */
            newEmail: string;
            /** @constant */
            purpose: "email_change";
        } | {
            /** @constant */
            purpose: "password_change";
        };
        CredentialChangeInput: {
            /** Format: uuid */
            challengeId: string;
            code: string;
            /** @constant */
            kind: "email_change";
        } | {
            /** Format: uuid */
            challengeId: string;
            code: string;
            /** @constant */
            kind: "password_change";
            newPassword: string;
        };
        Csrf: {
            token: string;
        };
        Decimal: string;
        Decision: {
            /** @description True only for a staff acceptance that waived qualification limits with explicit confirmation; reasonCodes then list the exceeded limits plus accepted_over_limits. */
            acceptedOverLimits: boolean;
            basis: components["schemas"]["EvaluationSnapshot"];
            /** Format: date-time */
            decidedAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            outcome: "accepted" | "rejected";
            reason: string | null;
            reasonCodes: string[];
            reviewedRevisionId: string | null;
            /** @description Reviewer summary for a staff decision (also shown for former members); null for system decisions. */
            reviewer: components["schemas"]["MemberSummary"] | null;
            reviewerId: string | null;
        };
        DecisionInput: {
            /** @description Optional, false when omitted. Explicit reviewer confirmation to accept a manual report over qualification limits. Only valid with decision accept and a null proposalId (422 otherwise). Required when the review acceptance mode is over_limits and rejected with 409 when it is ordinary or unavailable. */
            confirmOverLimits?: boolean;
            /** @enum {string} */
            decision: "accept" | "reject";
            /** Format: uuid */
            factRevisionId: string;
            proposalId: string | null;
            reason: string;
            /** Format: uuid */
            reviewedRevisionId: string;
        };
        EffectiveCatalogPin: {
            /** Format: uuid */
            entityId: string;
        };
        EffectiveTripFacts: {
            actualCompletedAt: string | null;
            actualDistanceM: components["schemas"]["Decimal"] | null;
            actualStartAt: string | null;
            cargo: components["schemas"]["EffectiveCatalogPin"] | null;
            /** @description Cargo damage percentage of the effective fact. Null when unknown. */
            cargoDamagePercent?: number | null;
            cargoMassKg: components["schemas"]["Decimal"] | null;
            destination: components["schemas"]["EffectiveCatalogPin"] | null;
            destinationCompany?: components["schemas"]["TripStage4CompanyRef"] | null;
            /** Format: uuid */
            factRevisionId: string;
            origin: components["schemas"]["EffectiveCatalogPin"] | null;
            originCompany?: components["schemas"]["TripStage4CompanyRef"] | null;
            plannedDistanceM: components["schemas"]["Decimal"] | null;
            /** @enum {string} */
            provider: "manual" | "ets2telemetry";
            /** @description Recorded classifications for the effective telemetry fact in a private trip view. */
            recordedTelemetry?: {
                /** @enum {string} */
                gameMode: "single-player" | "truckersmp" | "haulmp" | "unknown";
                /** @enum {string} */
                hardModeResult: "qualified" | "not-qualified" | "unknown";
                /** @enum {string} */
                jobType: "quick-job" | "freight-market" | "cargo-market" | "world-of-trucks" | "unknown";
            };
            ruleContextComplete: boolean;
            trailers: (components["schemas"]["EffectiveCatalogPin"] | null)[];
            trailersComplete: boolean;
            wholeTripDistanceSupported: boolean;
        };
        EmailChangeState: {
            pending: components["schemas"]["PendingEmailChange"] | null;
        };
        EmailVerificationInput: {
            /** Format: uuid */
            challengeId: string;
            code: string;
        };
        EnvelopeAcknowledged: {
            data: components["schemas"]["Acknowledged"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeAnalytics: {
            data: components["schemas"]["Analytics"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeApplication: {
            data: components["schemas"]["Application"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogDepot: {
            data: components["schemas"]["CatalogDepot"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogDepotList: {
            data: components["schemas"]["CatalogDepotList"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogImportPreview: {
            data: components["schemas"]["CatalogImportPreview"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogImportResult: {
            data: components["schemas"]["CatalogImportResult"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogItem: {
            data: components["schemas"]["CatalogItem"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogItemList: {
            data: components["schemas"]["CatalogItemList"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogSummary: {
            data: components["schemas"]["CatalogSummary"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeChallenge: {
            data: components["schemas"]["Challenge"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCommandResult: {
            data: components["schemas"]["CommandResult"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCompanyPublic: {
            data: components["schemas"]["CompanyPublic"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCompanySettings: {
            data: components["schemas"]["CompanySettings"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCompanyStatsPublic: {
            data: components["schemas"]["CompanyStatsPublic"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCsrf: {
            data: components["schemas"]["Csrf"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeDecision: {
            data: components["schemas"]["Decision"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeEmailChangeState: {
            data: components["schemas"]["EmailChangeState"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeEventMember: {
            data: components["schemas"]["EventMember"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeEventPublic: {
            data: components["schemas"]["EventPublic"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeEventResponseCounts: {
            data: components["schemas"]["EventResponseCounts"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeEvidence: {
            data: components["schemas"]["Evidence"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeIdentity: {
            data: components["schemas"]["Identity"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeIdentityVerification: {
            data: components["schemas"]["IdentityVerification"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeInvitation: {
            data: components["schemas"]["Invitation"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeInvitationLink: {
            data: components["schemas"]["InvitationLink"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeLeadershipChallengeState: {
            data: components["schemas"]["LeadershipChallengeState"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListAdminApplication: {
            data: components["schemas"]["ListAdminApplication"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListApplication: {
            data: components["schemas"]["ListApplication"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListAttendance: {
            data: components["schemas"]["ListAttendance"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListAuditEntry: {
            data: components["schemas"]["ListAuditEntry"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListEventPublic: {
            data: components["schemas"]["ListEventPublic"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListLeaderboardEntry: {
            data: components["schemas"]["ListLeaderboardEntry"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListManualCorrectionRequest: {
            data: components["schemas"]["ListManualCorrectionRequest"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListManualDraft: {
            data: components["schemas"]["ListManualDraft"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListManualReport: {
            data: components["schemas"]["ListManualReport"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListManualRevision: {
            data: components["schemas"]["ListManualRevision"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListMemberAdmin: {
            data: components["schemas"]["ListMemberAdmin"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListMemberSummary: {
            data: components["schemas"]["ListMemberSummary"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListMergeCandidate: {
            data: components["schemas"]["ListMergeCandidate"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListNotification: {
            data: components["schemas"]["ListNotification"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListParticipant: {
            data: components["schemas"]["ListParticipant"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListReconciliation: {
            data: components["schemas"]["ListReconciliation"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListSourceConnection: {
            data: components["schemas"]["ListSourceConnection"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListSteamReplacementProof: {
            data: components["schemas"]["ListSteamReplacementProof"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListTokenInfo: {
            data: components["schemas"]["ListTokenInfo"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListTripProposal: {
            data: components["schemas"]["ListTripProposal"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListTripSummary: {
            data: components["schemas"]["ListTripSummary"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeMailDelivery: {
            data: components["schemas"]["MailDelivery"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeManualCorrectionRequest: {
            data: components["schemas"]["ManualCorrectionRequest"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeManualDraft: {
            data: components["schemas"]["ManualDraft"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeManualReport: {
            data: components["schemas"]["ManualReport"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeManualRevision: {
            data: components["schemas"]["ManualRevisionRead"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeMemberAdmin: {
            data: components["schemas"]["MemberAdmin"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeMemberProfile: {
            data: components["schemas"]["MemberProfile"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeMyQualificationList: {
            data: components["schemas"]["MyQualificationList"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeNotificationFeed: {
            data: components["schemas"]["NotificationFeed"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeNotificationPreferences: {
            data: components["schemas"]["NotificationPreferences"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeOptionalEvent: {
            data: components["schemas"]["OptionalEvent"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeOwnTripStatusSummary: {
            data: components["schemas"]["OwnTripStatusSummary"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopePersonalConnectionCapabilities: {
            data: components["schemas"]["PersonalConnectionCapabilities"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopePreferences: {
            data: components["schemas"]["Preferences"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationLevelCommandResult: {
            data: components["schemas"]["QualificationLevelCommandResult"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationLevelDetail: {
            data: components["schemas"]["QualificationLevelDetail"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationLevelList: {
            data: components["schemas"]["QualificationLevelList"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationLevelRemovalResult: {
            data: components["schemas"]["QualificationLevelRemovalResult"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationManualChangeResult: {
            data: components["schemas"]["QualificationManualChangeResult"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeReconciliation: {
            data: components["schemas"]["Reconciliation"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeReinstatementOptions: {
            data: components["schemas"]["ReinstatementOptions"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeReview: {
            data: components["schemas"]["Review"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeRsvp: {
            data: components["schemas"]["Rsvp"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeSelf: {
            data: components["schemas"]["Self"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeSourceCapabilities: {
            data: components["schemas"]["SourceCapabilities"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeSourceConnection: {
            data: components["schemas"]["SourceConnection"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeSteamReplacementProof: {
            data: components["schemas"]["SteamReplacementProof"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeSyncStatus: {
            data: components["schemas"]["SyncStatus"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeTokenIssued: {
            data: components["schemas"]["TokenIssued"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeTripPrivate: {
            data: components["schemas"]["TripPrivate"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeTripProposal: {
            data: components["schemas"]["TripProposal"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeTripProposalDecision: components["schemas"]["EnvelopeDecision"] | components["schemas"]["EnvelopeTripProposal"];
        EnvelopeTripView: {
            data: components["schemas"]["TripView"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeUploadPolicy: {
            data: components["schemas"]["UploadPolicy"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeWorkspaceSummary: {
            data: components["schemas"]["WorkspaceSummary"];
            meta: components["schemas"]["Meta"];
        };
        Error: {
            error: {
                code: string;
                details?: components["schemas"]["SafeErrorDetail"][];
                messageKey: string;
                retryable: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        EvaluationSnapshot: {
            attendanceRevisionId: string | null;
            attributionAt: string | null;
            /** @enum {string} */
            attributionBasis: "actual_start" | "manual_confirmation" | "staff_resolution" | "unknown";
            eventId: string | null;
            /** Format: uuid */
            factRevisionId: string;
            levelId: string | null;
            qualificationAssignmentId: string | null;
            reportingAt: string | null;
        };
        EventAssociationInput: {
            /** Format: uuid */
            eventId: string;
        };
        EventInput: {
            description: string;
            destinationCityId: string | null;
            endsAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: date-time */
            meetingAt: string;
            meetingLocation: string;
            organizer: string;
            originCityId: string | null;
            prescribedCargoId: string | null;
            prescribedMassKg: string | null;
            prescribedTrailerTypeId: string | null;
            route: string;
            server: string;
            /** Format: date-time */
            startsAt: string;
            title: string;
            /** @enum {string} */
            visibility: "public" | "members";
        };
        EventMember: {
            event: components["schemas"]["EventPublic"];
            /** @enum {string} */
            myAttendance: "unconfirmed" | "attended" | "not_attended";
            myResponse: components["schemas"]["Rsvp"];
            prescribedCargoId: string | null;
            prescribedMassKg: string | null;
            prescribedTrailerTypeId: string | null;
            /** @enum {string} */
            visibility: "public" | "members";
        };
        EventPublic: {
            description: string;
            destination: components["schemas"]["CatalogLabel"] | null;
            endsAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            meetingAt: string;
            meetingLocation: string;
            organizer: string;
            origin: components["schemas"]["CatalogLabel"] | null;
            route: string;
            server: string;
            /** Format: date-time */
            startsAt: string;
            /** @enum {string} */
            status: "scheduled" | "cancelled" | "completed";
            title: string;
            version: number;
        };
        EventResponseCounts: {
            declined: number;
            participating: number;
        };
        EventStage2AdminList: {
            items: (components["schemas"]["EventStage2Draft"] | components["schemas"]["EventStage2AdminPublished"])[];
            nextCursor: string | null;
        };
        /** @description Only ready media have readable image metadata. Uploader identity, storage paths, hashes and generations stay private. */
        EventStage2AdminMediaItem: {
            /** Format: uuid */
            id: string;
            media: components["schemas"]["EventStage2Media"] | null;
            /** @enum {string} */
            state: "processing" | "ready" | "rejected";
        };
        EventStage2AdminMediaList: {
            items: components["schemas"]["EventStage2AdminMediaItem"][];
            version: number;
        };
        EventStage2AdminPublished: {
            definition: components["schemas"]["EventStage2Member"];
            /** Format: uuid */
            id: string;
            /** @constant */
            lifecycle: "published";
        };
        /** @description Leadership-only actual attendance totals across all rows in scope, independent of RSVP and pagination. */
        EventStage2Attendance: {
            items: components["schemas"]["EventStage2AttendanceRow"][];
            nextCursor: string | null;
            totals: {
                attended: number;
                notAttended: number;
                total: number;
                unconfirmed: number;
            };
        };
        /** @description The linked trip ID comes from the authorized Trips-owned association; null means no readable canonical trip. */
        EventStage2AttendanceRow: {
            /** @enum {string} */
            attendance: "unconfirmed" | "attended" | "not_attended";
            member: components["schemas"]["MemberSummary"];
            note: string | null;
            response: components["schemas"]["Rsvp"];
            tripId: string | null;
        };
        /** @description Canonical company, depot or DLC label independent of locale. Display the name on the left and code on the right. A depot uses the company name and code with the depot row ID. */
        EventStage2CanonicalCatalogOption: {
            code: string;
            /** Format: uuid */
            id: string;
            name: string;
        };
        EventStage2CreationInput: components["schemas"]["EventStage2DraftCreationInput"] | components["schemas"]["EventStage2PublishedCreationInput"];
        /** @description One entry per canonical DLC ID. from_city covers selected cities and depots; keep both provenance values when a derived DLC was also selected manually. */
        EventStage2Dlc: {
            code: string;
            /** Format: uuid */
            id: string;
            name: string;
            sources: ("from_city" | "manual")[];
        };
        EventStage2Draft: {
            fields: components["schemas"]["EventStage2DraftInput"];
            /** Format: uuid */
            id: string;
            /** @constant */
            lifecycle: "draft";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        /** @description Editable draft definition. Missing values are allowed. A PATCH replaces these draft fields; clear nullable selections by omitting them or sending null. Values that are supplied must satisfy their declared shape and applicable catalog rules. */
        EventStage2DraftCreationInput: {
            description?: string | null;
            destinationCityId?: string | null;
            destinationDepotId?: string | null;
            distanceKm?: string | null;
            /** @constant */
            draft: true;
            endsAt?: string | null;
            game?: ("ets2" | "ats") | null;
            meetingAt?: string | null;
            meetingLocation?: string | null;
            organizerMemberId?: string | null;
            originCityId?: string | null;
            originDepotId?: string | null;
            platform?: ("truckersmp" | "haulmp") | null;
            prescribedCargoId?: string | null;
            prescribedMassKg?: string | null;
            prescribedTrailerTypeId?: string | null;
            requiredDlcIds?: string[];
            route?: string | null;
            server?: string | null;
            startsAt?: string | null;
            title?: string | null;
            visibility?: ("public" | "members") | null;
        };
        EventStage2DraftDeletion: {
            /** Format: uuid */
            id: string;
            /** @constant */
            lifecycle: "discarded";
            version: number;
        };
        /** @description Editable draft definition. Missing values are allowed. A PATCH replaces these draft fields; clear nullable selections by omitting them or sending null. Values that are supplied must satisfy their declared shape and applicable catalog rules. */
        EventStage2DraftInput: {
            description?: string | null;
            destinationCityId?: string | null;
            destinationDepotId?: string | null;
            distanceKm?: string | null;
            endsAt?: string | null;
            game?: ("ets2" | "ats") | null;
            meetingAt?: string | null;
            meetingLocation?: string | null;
            organizerMemberId?: string | null;
            originCityId?: string | null;
            originDepotId?: string | null;
            platform?: ("truckersmp" | "haulmp") | null;
            prescribedCargoId?: string | null;
            prescribedMassKg?: string | null;
            prescribedTrailerTypeId?: string | null;
            requiredDlcIds?: string[];
            route?: string | null;
            server?: string | null;
            startsAt?: string | null;
            title?: string | null;
            visibility?: ("public" | "members") | null;
        };
        EventStage2EnvelopeAdminList: {
            data: components["schemas"]["EventStage2AdminList"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeAdminMediaList: {
            data: components["schemas"]["EventStage2AdminMediaList"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeAttendance: {
            data: components["schemas"]["EventStage2Attendance"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeCreation: {
            data: components["schemas"]["EventStage2Draft"] | components["schemas"]["EventStage2Member"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeDraft: {
            data: components["schemas"]["EventStage2Draft"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeDraftDeletion: {
            data: components["schemas"]["EventStage2DraftDeletion"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeMediaList: {
            data: components["schemas"]["EventStage2MediaList"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeMediaUpload: {
            data: components["schemas"]["EventStage2MediaUpload"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeMember: {
            data: components["schemas"]["EventStage2Member"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeMemberList: {
            data: components["schemas"]["EventStage2MemberList"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeNonresponders: {
            data: components["schemas"]["EventStage2Nonresponders"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopePublic: {
            data: components["schemas"]["EventStage2Public"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopePublicList: {
            data: components["schemas"]["EventStage2PublicList"];
            meta: components["schemas"]["Meta"];
        };
        EventStage2EnvelopeUpcoming: {
            data: components["schemas"]["EventStage2Upcoming"] | null;
            meta: components["schemas"]["Meta"];
        };
        /** @description Complete event definition for publication and published edits. A selected depot must be visible, in the selected city and in the same game; the origin depot supplies the meeting point. Deprecated text remains optional for compatibility. */
        EventStage2Input: {
            description?: string | null;
            destinationCityId: string | null;
            destinationDepotId?: string | null;
            distanceKm?: string | null;
            endsAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: date-time */
            meetingAt: string;
            meetingLocation?: string | null;
            /** Format: uuid */
            organizerMemberId: string;
            originCityId: string | null;
            originDepotId?: string | null;
            /** @enum {string} */
            platform: "truckersmp" | "haulmp";
            prescribedCargoId: string | null;
            prescribedMassKg: string | null;
            prescribedTrailerTypeId: string | null;
            requiredDlcIds: string[];
            route?: string | null;
            server: string;
            /** Format: date-time */
            startsAt: string;
            title: string;
            /** @enum {string} */
            visibility: "public" | "members";
        };
        EventStage2Media: {
            byteLength: number;
            caption: string | null;
            /** @enum {string} */
            contentType: "image/png" | "image/jpeg";
            height: number;
            /** Format: uuid */
            id: string;
            isCover: boolean;
            position: number;
            width: number;
        };
        /** @description Update any supplied fields. Position is zero-based; the server reorders atomically. A true cover flag replaces the current cover, false clears the cover only if this image is the current cover. */
        EventStage2MediaEditInput: {
            caption?: string | null;
            isCover?: boolean;
            position?: number;
        };
        EventStage2MediaList: {
            items: components["schemas"]["EventStage2Media"][];
            version: number;
        };
        EventStage2MediaUpload: {
            item: components["schemas"]["EventStage2AdminMediaItem"];
            version: number;
        };
        EventStage2MediaUploadInput: {
            /**
             * Format: binary
             * @description One PNG or JPEG, subject to the existing manual evidence file-byte and decoded-pixel limits.
             */
            file: string;
        };
        EventStage2Member: {
            event: components["schemas"]["EventStage2Public"];
            /** @enum {string} */
            myAttendance: "unconfirmed" | "attended" | "not_attended";
            myResponse: components["schemas"]["Rsvp"];
            organizerMemberId: string | null;
            prescribedCargo: components["schemas"]["CatalogLabel"] | null;
            prescribedCargoId: string | null;
            prescribedMassKg: string | null;
            prescribedTrailerType: components["schemas"]["CatalogLabel"] | null;
            prescribedTrailerTypeId: string | null;
            responseCounts: components["schemas"]["EventResponseCounts"];
            /** @enum {string} */
            visibility: "public" | "members";
        };
        EventStage2MemberList: {
            items: components["schemas"]["EventStage2MemberListItem"][];
            nextCursor: string | null;
        };
        /** @description Null own response indicates unavailable. Unanswered is a known absence of an answer. Counts exclude unanswered and contain no identities or reasons. */
        EventStage2MemberListItem: {
            event: components["schemas"]["EventStage2Public"];
            myResponse: ("unanswered" | "participating" | "declined") | null;
            /** @description Current own RSVP version for If-Match. Starts at 1 when an eligible member has no RSVP row. Null exactly when myResponse is null. */
            myResponseVersion: number | null;
            organizerMemberId: string | null;
            responseCounts: components["schemas"]["EventResponseCounts"];
            /** @enum {string} */
            visibility: "public" | "members";
        } & ({
            myResponse: null;
            myResponseVersion: null;
        } | {
            myResponse: string;
            myResponseVersion: number;
        });
        EventStage2Nonresponders: {
            items: components["schemas"]["MemberSummary"][];
            nextCursor: string | null;
        };
        /** @description Published public projection. Organizer is safe display text, with legacy text fallback when there is no member link. Missing structured fields on older revisions remain null. City labels follow the requested locale. */
        EventStage2Public: {
            description: string | null;
            destination: components["schemas"]["CatalogLabel"] | null;
            destinationDepot: components["schemas"]["EventStage2CanonicalCatalogOption"] | null;
            distanceKm: string | null;
            endsAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            hasCover: boolean;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            meetingAt: string;
            meetingLocation: string | null;
            organizer: string;
            origin: components["schemas"]["CatalogLabel"] | null;
            originDepot: components["schemas"]["EventStage2CanonicalCatalogOption"] | null;
            platform: ("truckersmp" | "haulmp") | null;
            requiredDlcs: components["schemas"]["EventStage2Dlc"][];
            route: string | null;
            server: string;
            /** Format: date-time */
            startsAt: string;
            /** @enum {string} */
            status: "scheduled" | "cancelled" | "completed";
            title: string;
            version: number;
        };
        EventStage2PublicationInput: Record<string, never>;
        EventStage2PublicList: {
            items: components["schemas"]["EventStage2Public"][];
            nextCursor: string | null;
        };
        /** @description Complete event definition for publication and published edits. A selected depot must be visible, in the selected city and in the same game; the origin depot supplies the meeting point. Deprecated text remains optional for compatibility. */
        EventStage2PublishedCreationInput: {
            description?: string | null;
            destinationCityId: string | null;
            destinationDepotId?: string | null;
            distanceKm?: string | null;
            /** @constant */
            draft?: false;
            endsAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: date-time */
            meetingAt: string;
            meetingLocation?: string | null;
            /** Format: uuid */
            organizerMemberId: string;
            originCityId: string | null;
            originDepotId?: string | null;
            /** @enum {string} */
            platform: "truckersmp" | "haulmp";
            prescribedCargoId: string | null;
            prescribedMassKg: string | null;
            prescribedTrailerTypeId: string | null;
            requiredDlcIds: string[];
            route?: string | null;
            server: string;
            /** Format: date-time */
            startsAt: string;
            title: string;
            /** @enum {string} */
            visibility: "public" | "members";
        };
        EventStage2Upcoming: {
            event: components["schemas"]["EventStage2Public"];
            myResponse: ("unanswered" | "participating" | "declined") | null;
            /** @description Current own RSVP version for If-Match. Starts at 1 when an eligible member has no RSVP row. Null exactly when myResponse is null. */
            myResponseVersion: number | null;
        } & ({
            myResponse: null;
            myResponseVersion: null;
        } | {
            myResponse: string;
            myResponseVersion: number;
        });
        /** @description Stable public states only: internal deleting returns retryable 503 EVIDENCE_TRANSITION on metadata/content access, never ready. Expired metadata/history remains readable; expired content returns 410 EVIDENCE_EXPIRED. No paths or object generations are exposed. */
        Evidence: {
            byteLength: number;
            contentType: string;
            /** Format: uuid */
            id: string;
            originalName: string;
            /** @enum {string} */
            state: "processing" | "ready" | "rejected" | "expired";
        };
        /** @enum {string} */
        Game: "ets2" | "ats";
        /** Format: uuid */
        Id: string;
        Identity: {
            identityEpoch: number;
            pendingReplacementId: string | null;
            steamProfileUrl: string | null;
            /** @enum {string} */
            steamStatus: "unlinked" | "pending" | "verified" | "review_required";
            truckersMp: {
                checkedAt: string | null;
                displayName: string | null;
                failure: ("transport" | "timeout" | "rate_limited" | "unavailable" | "invalid_response") | null;
                found: boolean | null;
                lastAttemptAt: string | null;
                playerId: string | null;
                /** @enum {string} */
                status: "available" | "stale" | "unavailable" | "not_linked";
                vtc: {
                    id: string | null;
                    inVtc: boolean;
                    memberId: string | null;
                    name: string | null;
                    tag: string | null;
                } | null;
            };
        };
        IdentityVerification: {
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            /** Format: uri */
            verificationUrl: string;
        };
        Invitation: {
            /** Format: uuid */
            applicationId: string;
            deliveryId: string | null;
            /**
             * @description Current safe delivery state from the messaging owner; not_requested means no email has been requested for this generation, including when mail is disabled; unavailable means its adapter is not currently configured. Provider acceptance or local simulation never means inbox delivery.
             * @enum {string}
             */
            emailDelivery: "queued" | "attempting" | "retryable" | "accepted" | "simulated" | "suppressed" | "failed" | "ambiguous" | "not_requested" | "unavailable";
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state: "active" | "reserved" | "used" | "revoked" | "expired";
            version: number;
        };
        InvitationLink: {
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            invitationId: string;
            /** Format: uri */
            link: string;
        };
        InvitationStage4Applicant: {
            /** Format: email */
            email: string;
            nickname: string;
        };
        InvitationStage4List: {
            items: components["schemas"]["InvitationStage4ListItem"][];
            nextCursor: string | null;
            /** @description Matching current generations before paging. */
            total: number;
        };
        InvitationStage4ListEnvelope: {
            data: components["schemas"]["InvitationStage4List"];
            meta: components["schemas"]["Meta"];
        };
        /** @description The current invitation generation of one approved application and its applicant. Never contains the link, token, secret hash or ciphertext. */
        InvitationStage4ListItem: {
            applicant: components["schemas"]["InvitationStage4Applicant"];
            invitation: components["schemas"]["Invitation"];
        };
        LeaderboardEntry: {
            acceptedTrips: number;
            actualDistanceM: string;
            member: components["schemas"]["MemberSummary"];
            /** @description 1-based ordinal under the leaderboard order. */
            position?: number;
        };
        LeadershipChallengeInput: {
            /** Format: uuid */
            successorId: string;
        };
        LeadershipChallengeState: {
            pending: components["schemas"]["PendingLeadershipChallenge"] | null;
            resendAvailableAt: string | null;
        };
        LeadershipConfirmInput: {
            /** Format: uuid */
            challengeId: string;
            code: string;
        };
        LifetimeTripTotals: {
            acceptedTrips: number;
            actualDistanceM: components["schemas"]["Decimal"];
        };
        ListAdminApplication: {
            items: components["schemas"]["Application"][];
            nextCursor: string | null;
            statusCounts?: components["schemas"]["AdminApplicationStatusCounts"];
        };
        ListApplication: {
            items: components["schemas"]["Application"][];
            nextCursor: string | null;
        };
        ListAttendance: {
            items: components["schemas"]["Attendance"][];
            nextCursor: string | null;
        };
        ListAuditEntry: {
            items: components["schemas"]["AuditEntry"][];
            nextCursor: string | null;
        };
        ListEventPublic: {
            items: components["schemas"]["EventPublic"][];
            nextCursor: string | null;
        };
        ListLeaderboardEntry: {
            /**
             * Format: date
             * @description Actually covered range start.
             */
            fromDate?: string;
            items: components["schemas"]["LeaderboardEntry"][];
            nextCursor: string | null;
            /** @enum {string} */
            period?: "range" | "all_time";
            /** @description Members ranked in this period. */
            rankedMembers?: number;
            /**
             * Format: date
             * @description Actually covered range end (exclusive).
             */
            toDateExclusive?: string;
            /** @description Null when the viewer is not ranked. */
            viewer?: components["schemas"]["AnalyticsStage4LeaderboardViewer"] | null;
        };
        ListManualCorrectionRequest: {
            items: components["schemas"]["ManualCorrectionRequest"][];
            nextCursor: string | null;
        };
        ListManualDraft: {
            editingCount?: number;
            items: components["schemas"]["ManualDraft"][];
            nextCursor: string | null;
        };
        ListManualReport: {
            items: components["schemas"]["ManualReport"][];
            nextCursor: string | null;
        };
        ListManualRevision: {
            items: components["schemas"]["ManualRevisionRead"][];
            nextCursor: string | null;
        };
        ListMemberAdmin: {
            items: components["schemas"]["MemberAdmin"][];
            nextCursor: string | null;
            statusCounts?: components["schemas"]["AdminMemberStatusCounts"];
        };
        ListMemberSummary: {
            items: components["schemas"]["MemberSummary"][];
            nextCursor: string | null;
        };
        ListMergeCandidate: {
            items: components["schemas"]["MergeCandidate"][];
            nextCursor: string | null;
        };
        ListNotification: {
            items: components["schemas"]["Notification"][];
            nextCursor: string | null;
        };
        ListParticipant: {
            items: components["schemas"]["Participant"][];
            nextCursor: string | null;
        };
        ListReconciliation: {
            items: components["schemas"]["Reconciliation"][];
            nextCursor: string | null;
        };
        ListSourceConnection: {
            items: components["schemas"]["SourceConnection"][];
            nextCursor: string | null;
        };
        ListSteamReplacementProof: {
            items: components["schemas"]["SteamReplacementProof"][];
            nextCursor: string | null;
        };
        ListTokenInfo: {
            items: components["schemas"]["TokenInfo"][];
            nextCursor: string | null;
        };
        ListTripProposal: {
            items: components["schemas"]["TripProposal"][];
            nextCursor: string | null;
        };
        ListTripSummary: {
            items: components["schemas"]["TripSummary"][];
            nextCursor: string | null;
            /** @description Authorized filtered trip count before cursor and limit. After VTC-115 activation, present on every successful mine and company page (including the default company scope and ownerId filters), and zero for an empty filtered set. Optional in review scope and in this shared schema for compatibility. */
            total?: number;
        };
        LoginInput: {
            /** Format: email */
            email: string;
            password: string;
            /** @description Selects a fixed 30-day session when true. Omission or false selects the fixed 24-hour session. */
            rememberMe?: boolean;
        };
        MailDelivery: {
            attempts: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "email_verification" | "password_reset" | "password_change" | "email_change" | "succession" | "invitation" | "rejection";
            /** Format: date-time */
            nextAttemptAt: string | null;
            /** @enum {string|null} */
            recovery: null | "rate_limit" | "daily_quota" | "monthly_quota" | "authentication" | "validation" | "idempotency_conflict" | "concurrent_request" | "provider_unavailable" | "acceptance_unknown" | "payload_unavailable" | "obsolete" | "idempotency_expired" | "attempts_exhausted" | "provider_changed" | "worker_configuration" | "not_started";
            /** @enum {string} */
            state: "queued" | "attempting" | "retryable" | "accepted" | "simulated" | "suppressed" | "failed" | "ambiguous";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        /** @description Unresolved diagnostic text is not a canonical identity or name mapping and always requires human review. The server validates the resolved entity's game and kind, and rejects a newly chosen hidden entity. */
        ManualCatalogSelection: components["schemas"]["ManualResolvedSelection"] | components["schemas"]["ManualUnresolvedSelection"];
        /** @description Immutable author request and retained status history; baseRevisionId is null for a telemetry-only accepted trip. Does not represent a VTC-029 proposal, staff application or recalculation. Current accepted result remains effective. */
        ManualCorrectionRequest: {
            baseRevisionId: string | null;
            baseTripVersion: number;
            history: components["schemas"]["ManualCorrectionRequestHistory"][];
            /** Format: uuid */
            id: string;
            reason: string;
            /** Format: date-time */
            requestedAt: string;
            /** @enum {string} */
            status: "pending" | "resolved" | "declined";
            /** Format: uuid */
            tripId: string;
        };
        ManualCorrectionRequestHistory: {
            reason: string | null;
            /** Format: date-time */
            recordedAt: string;
            /** @enum {string} */
            status: "pending" | "resolved" | "declined";
        };
        /** @description Complete dated manual submission. At submission both instants must be nonfuture, and startedAt must be strictly earlier than completedAt. The dates are reference facts only. Reporting, qualification and progress continue to use staff confirmation. */
        ManualDatedSubmissionFields: {
            actualDistanceM: components["schemas"]["Decimal"];
            cargo: components["schemas"]["ManualCatalogSelection"];
            cargoDamagePercent?: number;
            cargoMassKg: components["schemas"]["Decimal"];
            comment?: string | null;
            /** @description Reference completion time supplied by the driver. */
            completedAt: components["schemas"]["Timestamp"];
            destination: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected destination city. */
            destinationCompanyId?: components["schemas"]["Id"];
            eventId?: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            origin: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected origin city. */
            originCompanyId?: components["schemas"]["Id"];
            /** @description Reference start time supplied by the driver. */
            startedAt: components["schemas"]["Timestamp"];
            trailerType: components["schemas"]["ManualCatalogSelection"];
        };
        /** @description Owner-only durable draft. No source/canonical trip exists before submission; a successful submission freezes this draft and retains a discoverable submittedReportId. */
        ManualDraft: {
            /** Format: date-time */
            createdAt: string;
            fields: components["schemas"]["ManualDraftEditableFields"];
            /** Format: uuid */
            id: string;
            /** @description Display labels for the current origin, destination and cargo selections. A missing label is null. */
            readonly labels?: components["schemas"]["ManualDraftLabels"];
            /** @enum {string} */
            state: "editing" | "submitted";
            submittedReportId: string | null;
            targetTrip: components["schemas"]["ManualTelemetryTarget"] | null;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        /** @description Partial draft fields, including independently optional reference dates. Read-only display labels are never write fields. */
        ManualDraftEditableFields: {
            actualDistanceM?: components["schemas"]["Decimal"];
            cargo?: components["schemas"]["ManualCatalogSelection"];
            cargoDamagePercent?: number;
            cargoMassKg?: components["schemas"]["Decimal"];
            comment?: string | null;
            /** @description Reference completion time supplied by the driver. */
            completedAt?: components["schemas"]["Timestamp"];
            destination?: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected destination city. */
            destinationCompanyId?: components["schemas"]["Id"];
            eventId?: string | null;
            evidenceIds?: string[];
            /** @enum {string} */
            game?: "ets2" | "ats";
            origin?: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected origin city. */
            originCompanyId?: components["schemas"]["Id"];
            /** @description Reference start time supplied by the driver. */
            startedAt?: components["schemas"]["Timestamp"];
            trailerType?: components["schemas"]["ManualCatalogSelection"];
        };
        ManualDraftFields: {
            actualDistanceM?: components["schemas"]["Decimal"];
            cargo?: components["schemas"]["ManualCatalogSelection"];
            cargoMassKg?: components["schemas"]["Decimal"];
            comment?: string | null;
            destination?: components["schemas"]["ManualCatalogSelection"];
            eventId?: string | null;
            evidenceIds?: string[];
            /** @enum {string} */
            game?: "ets2" | "ats";
            origin?: components["schemas"]["ManualCatalogSelection"];
            trailerType?: components["schemas"]["ManualCatalogSelection"];
        };
        /** @description Complete final fields replace partial draft fields in the same guarded submission. Draft target is retained; update the draft with a fresh telemetry target version before retrying a stale target. */
        ManualDraftFinalSubmissionInput: {
            fields: components["schemas"]["ManualDatedSubmissionFields"];
        };
        ManualDraftInput: {
            fields: components["schemas"]["ManualDraftFields"];
            targetTrip?: components["schemas"]["ManualTelemetryTarget"] | null;
        };
        ManualDraftLabels: {
            cargo: components["schemas"]["CatalogLabel"] | null;
            destination: components["schemas"]["CatalogLabel"] | null;
            origin: components["schemas"]["CatalogLabel"] | null;
        };
        /** @description Complete final fields replace partial draft fields in the same guarded submission. Draft target is retained; update the draft with a fresh telemetry target version before retrying a stale target. */
        ManualDraftSubmission: {
            fields: components["schemas"]["ManualSubmissionFields"];
        };
        ManualDraftWriteInput: {
            fields: components["schemas"]["ManualDraftEditableFields"];
            targetTrip?: components["schemas"]["ManualTelemetryTarget"] | null;
        };
        ManualInput: {
            actualDistanceM: string;
            /** Format: uuid */
            cargoId: string;
            cargoMassKg: string;
            comment: string | null;
            /** Format: uuid */
            destinationCityId: string;
            eventId: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            originCityId: string;
            /** Format: uuid */
            trailerTypeId: string;
        };
        /** @description Private permanent report identity and current immutable revision. version is the report ETag; tripVersion is the separate authoritative canonical trip version. Effective decisions remain trip-owned. */
        ManualReport: {
            /** Format: date-time */
            createdAt: string;
            currentRevision: components["schemas"]["ManualRevisionRead"];
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            tripId: string;
            tripVersion: number;
            version: number;
        };
        ManualReportCreationInput: {
            fields: components["schemas"]["ManualDatedSubmissionFields"];
            targetTrip?: components["schemas"]["ManualTelemetryTarget"] | null;
        };
        /** @description Immutable submitted fields with omitted event/comment normalized to null. Resolved and unresolved selections retain their original values, never inferred catalog IDs. */
        ManualReportFields: {
            actualDistanceM: components["schemas"]["Decimal"];
            cargo: components["schemas"]["ManualCatalogSelection"];
            cargoMassKg: components["schemas"]["Decimal"];
            comment: string | null;
            destination: components["schemas"]["ManualCatalogSelection"];
            eventId: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            origin: components["schemas"]["ManualCatalogSelection"];
            trailerType: components["schemas"]["ManualCatalogSelection"];
        };
        ManualReportInput: {
            fields: components["schemas"]["ManualSubmissionFields"];
            targetTrip?: components["schemas"]["ManualTelemetryTarget"] | null;
        };
        /** @description Immutable submitted fields including available reference facts. Old records can omit the new fields. They do not change effective reporting, rule selection or credited progress. Reference dates appear together when present. */
        ManualReportReadFields: {
            actualDistanceM: components["schemas"]["Decimal"];
            cargo: components["schemas"]["ManualCatalogSelection"];
            cargoDamagePercent?: number;
            cargoMassKg: components["schemas"]["Decimal"];
            comment: string | null;
            completedAt?: never;
            destination: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected destination city. */
            destinationCompanyId?: components["schemas"]["Id"];
            eventId: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            origin: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected origin city. */
            originCompanyId?: components["schemas"]["Id"];
            startedAt?: never;
            trailerType: components["schemas"]["ManualCatalogSelection"];
        } | {
            actualDistanceM: components["schemas"]["Decimal"];
            cargo: components["schemas"]["ManualCatalogSelection"];
            cargoDamagePercent?: number;
            cargoMassKg: components["schemas"]["Decimal"];
            comment: string | null;
            /** @description Reference completion time supplied by the driver. */
            completedAt: components["schemas"]["Timestamp"];
            destination: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected destination city. */
            destinationCompanyId?: components["schemas"]["Id"];
            eventId: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            origin: components["schemas"]["ManualCatalogSelection"];
            /** @description Selected company with a visible same-game depot in the selected origin city. */
            originCompanyId?: components["schemas"]["Id"];
            /** @description Reference start time supplied by the driver. */
            startedAt: components["schemas"]["Timestamp"];
            trailerType: components["schemas"]["ManualCatalogSelection"];
        };
        ManualReportResubmissionInput: {
            expectedTripVersion: number;
            fields: components["schemas"]["ManualDatedSubmissionFields"];
        };
        ManualReportRevision: {
            fields: components["schemas"]["ManualReportReadFields"];
            /** Format: uuid */
            id: string;
            number: number;
            /** Format: uuid */
            reportId: string;
            /** @constant */
            representation: "extended";
            /** Format: date-time */
            submittedAt: string;
        };
        ManualReportRevisionInput: {
            expectedTripVersion: number;
            fields: components["schemas"]["ManualSubmissionFields"];
        };
        /** @description Backward-compatible resolved write input. Omitted event/comment normalize to null in the unchanged legacy ManualRevision readback. */
        ManualResolvedInput: {
            actualDistanceM: string;
            /** Format: uuid */
            cargoId: string;
            cargoMassKg: string;
            comment?: string | null;
            /** Format: uuid */
            destinationCityId: string;
            eventId?: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            originCityId: string;
            /** Format: uuid */
            trailerTypeId: string;
        };
        ManualResolvedSelection: {
            /** Format: uuid */
            entityId: string;
            /** @constant */
            status: "resolved";
        };
        ManualRevision: {
            fields: components["schemas"]["ManualInput"];
            /** Format: uuid */
            id: string;
            number: number;
            /** Format: date-time */
            submittedAt: string;
        };
        /** @description Coordinated VTC-025 response migration: unchanged legacy resolved revision or complete extended revision. Never omit an unresolved revision or invent canonical IDs. */
        ManualRevisionRead: components["schemas"]["ManualRevision"] | components["schemas"]["ManualReportRevision"];
        /** @description Complete undated manual submission. Optional event/comment accept omission or null; persisted immutable readback normalizes omissions to explicit null while preserving original selections. Exact quantities are validated against persistence precision without rounding. No submission implies acceptance or progress credit. */
        ManualSubmissionFields: {
            actualDistanceM: components["schemas"]["Decimal"];
            cargo: components["schemas"]["ManualCatalogSelection"];
            cargoMassKg: components["schemas"]["Decimal"];
            comment?: string | null;
            destination: components["schemas"]["ManualCatalogSelection"];
            eventId?: string | null;
            evidenceIds: string[];
            /** @enum {string} */
            game: "ets2" | "ats";
            origin: components["schemas"]["ManualCatalogSelection"];
            trailerType: components["schemas"]["ManualCatalogSelection"];
        };
        /** @description Explicit same-owner/game canonical target with actual telemetry source, validated under current trip locks. No heuristic matching. expectedVersion is the authoritative trip version, not the report/draft version. */
        ManualTelemetryTarget: {
            expectedVersion: number;
            /** Format: uuid */
            tripId: string;
        };
        ManualUnresolvedSelection: {
            context: string | null;
            label: string;
            locale: ("en" | "ru") | null;
            /** @enum {string} */
            reasonCode: "not_found" | "ambiguous" | "not_listed";
            /** @constant */
            status: "unresolved";
        };
        MemberAdmin: {
            accessEpoch: number;
            /** Format: email */
            email: string;
            identityEpoch: number;
            lastAcceptedTripAt: string | null;
            profile: components["schemas"]["MemberProfile"];
            /** @enum {string} */
            status: "active" | "inactive";
            version: number;
        };
        MemberProfile: {
            /** @description Accepted canonical trips and exact actual distance with reportingAt in the 30 days ending at last30DaysEndsAt, the directory's rule (VTC-160). Zero is a computed zero; absent, with last30DaysEndsAt, when accepted-trip facts are unavailable. */
            last30Days?: components["schemas"]["AnalyticsStage4Totals"];
            /** @description Server-clock end of the profile's 30-day window (VTC-160). */
            last30DaysEndsAt?: components["schemas"]["Timestamp"];
            /** @description reportingAt of the member's latest accepted canonical trip; null when none. */
            lastAcceptedTripAt?: components["schemas"]["Timestamp"] | null;
            /** @description All-game lifetime accepted canonical trip count and exact actual distance in metres for this visible member profile. */
            lifetimeTotals?: components["schemas"]["LifetimeTripTotals"];
            member: components["schemas"]["MemberSummary"];
            /** @description Latest join or return to the company. After a reinstatement this is the return time; the first join stays in membership history. */
            memberSince?: components["schemas"]["Timestamp"];
            qualifications: components["schemas"]["Assignment"][];
        };
        MembershipInput: {
            /** @enum {string} */
            membership: "trainee" | "driver";
            reason: string;
        };
        /** @description Company-wide member totals returned on every page and read in the page's transaction. */
        MemberStage4DirectoryCounts: {
            /** @description Active members of the company; ignores the search, role, level and status filters. */
            active: number;
            /** @description Active members with at least one accepted canonical trip whose reportingAt lies in [windowEndsAt - 30 days, windowEndsAt], the rule of last30Days; ignores the filters. Absent, never zero, when accepted-trip facts are unavailable. */
            droveLast30Days?: number;
            /** @description Former members of the company; ignores the search, role, level and status filters. */
            former: number;
        };
        /** @description MemberSummary plus the Stage 4 directory facts. Every row carries both when accepted-trip facts are available; both are absent, never zero, when they are not. */
        MemberStage4DirectoryEntry: {
            formerMember: boolean;
            /** Format: uuid */
            id: string;
            /** @description Accepted canonical trips and actual distance with reportingAt in the 30-day window ending at the list windowEndsAt. Zero rows are included. */
            last30Days?: components["schemas"]["AnalyticsStage4Totals"];
            /** @description reportingAt of the member's latest accepted canonical trip; null when none. */
            lastAcceptedTripAt?: components["schemas"]["Timestamp"] | null;
            /** @description Current level per game; absent when qualifications are unavailable. */
            levels?: components["schemas"]["MemberStage4DirectoryLevels"];
            nickname: string;
            roles: ("trainee" | "driver" | "dispatcher" | "deputy_director" | "director")[];
        };
        /** @description A current level as listQualificationLevels returns it to the reader: same ID, name and 1-based position. */
        MemberStage4DirectoryLevel: {
            /** Format: uuid */
            id: string;
            name: string;
            position: number;
        };
        /** @description The member's current level per game. A game is null when the member has no current assignment in it, for every former member, and when the assigned level is no longer on the active ladder. */
        MemberStage4DirectoryLevels: {
            ats: components["schemas"]["MemberStage4DirectoryLevel"] | null;
            ets2: components["schemas"]["MemberStage4DirectoryLevel"] | null;
        };
        MemberStage4DirectoryList: {
            items: components["schemas"]["MemberStage4DirectoryEntry"][];
            nextCursor: string | null;
            statusCounts?: components["schemas"]["MemberStage4DirectoryCounts"];
            /** @description End of the 30-day window used by every row of this page and bound into the cursor. */
            windowEndsAt?: components["schemas"]["Timestamp"];
        };
        MemberStage4DirectoryListEnvelope: {
            data: components["schemas"]["MemberStage4DirectoryList"];
            meta: components["schemas"]["Meta"];
        };
        MemberSummary: {
            formerMember: boolean;
            /** Format: uuid */
            id: string;
            nickname: string;
            roles: ("trainee" | "driver" | "dispatcher" | "deputy_director" | "director")[];
        };
        MergeCandidate: {
            /** @enum {string} */
            confidence: "review_required";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            primaryTripId: string;
            reasonCodes: string[];
            /** Format: uuid */
            secondaryTripId: string;
        };
        MergeInput: {
            /** Format: uuid */
            primaryTripId: string;
            primaryVersion: number;
            reason: string;
            /** Format: uuid */
            secondaryTripId: string;
            secondaryVersion: number;
        };
        MergeReversalInput: {
            primaryVersion: number;
            reason: string;
            secondaryVersion: number;
        };
        Meta: {
            requestId: string;
        };
        /** @description A member's current level in one game. Progress counts credited trips and their actual distance on the current level; a member without a current level has a null level and zero progress. */
        MyQualification: {
            conditions: components["schemas"]["QualificationConditions"] | null;
            game: components["schemas"]["Game"];
            level: {
                id: components["schemas"]["Id"];
                name: string;
                position: number;
            } | null;
            nextLevel: components["schemas"]["QualificationLevelRef"] | null;
            progress: components["schemas"]["QualificationProgress"];
            since: components["schemas"]["Timestamp"] | null;
        };
        MyQualificationList: {
            items: components["schemas"]["MyQualification"][];
        };
        Notification: {
            category: string;
            display: {
                actorNickname: string | null;
                eventTitle: string | null;
                game: ("ets2" | "ats") | null;
            };
            /** Format: uuid */
            id: string;
            liveToastEligible: boolean;
            messageKey: string;
            /** Format: date-time */
            occurredAt: string;
            readAt: string | null;
            target: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                kind: "trip" | "event" | "qualification" | "application" | "member";
            } | null;
        };
        NotificationFeed: {
            hasMore: boolean;
            items: components["schemas"]["Notification"][];
            nextCursor: string;
            /** Format: date-time */
            serverTime: string;
            unreadCount: number;
        };
        /** @description The six existing toggles are always present. Stage 4 toggles appear only when the viewer can use them; a write must send exactly the keys the read returned, otherwise 422. */
        NotificationPreferences: {
            eventChanges: boolean;
            eventReminders: boolean;
            /** @description New admission applications; returned only with applications.manage. */
            newApplications?: boolean;
            /** @description A new event visible to the viewer was published. */
            newEvent?: boolean;
            qualificationChanges: boolean;
            /** @description Review queue items; returned only with trips.review. */
            reviewQueue?: boolean;
            /** @description The viewer's own trip was accepted. */
            tripAccepted?: boolean;
            tripFinished: boolean;
            tripRejected: boolean;
            tripStarted: boolean;
        };
        /**
         * @description Known notification categories; messageKey is notifications.<category>. Notification.category stays a free string so clients ignore unknown values.
         * @enum {string}
         */
        NotificationStage4Category: "trip.started" | "trip.finished" | "trip.cancelled" | "trip.rejected" | "trip.review_required" | "trip.correction_requested" | "event.start_changed" | "event.route_changed" | "event.cancelled" | "event.reminder" | "qualification.assigned" | "qualification.promoted" | "application.submitted" | "application.decided" | "member.access_changed" | "trip.accepted" | "event.published";
        OptionalEvent: components["schemas"]["EventPublic"] | null;
        OwnTripStatusSummary: {
            activeTrips: number;
            correctionPending: number;
            counts: {
                accepted: number;
                pendingReview: number;
                rejected: number;
                unassessed: number;
            };
            /** @description Lifetime accepted canonical trip count and exact actual distance in metres, restricted by the optional game filter when supplied. */
            lifetimeTotals?: components["schemas"]["LifetimeTripTotals"];
        };
        Participant: {
            member: components["schemas"]["MemberSummary"];
        };
        PasswordResetInput: {
            newPassword: string;
            token: string;
        };
        PasswordResetRequest: {
            /** Format: email */
            email: string;
        };
        PendingEmailChange: {
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            /** Format: email */
            proposedEmail: string;
            /** @enum {string} */
            stage: "current_email" | "proposed_email";
        };
        PendingLeadershipChallenge: {
            attemptsRemaining: number;
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            successor: components["schemas"]["MemberSummary"];
        };
        PersonalConnectionCapabilities: {
            externalIdentities: boolean;
            telemetry: boolean;
        };
        Preferences: {
            displayTimezone: string;
            /** @enum {string} */
            locale: "en" | "ru";
        };
        PreferencesInput: {
            /** @description IANA time zone for displayed times. Null means as on the device; server-generated texts use the company reporting time zone. */
            displayTimezone?: string | null;
            /** @enum {string} */
            locale?: "en" | "ru";
        };
        /** @description Preferences whose displayTimezone can be null (as on the device). */
        PreferencesStage4: {
            /** @description IANA time zone for displayed times. Null means as on the device; server-generated texts use the company reporting time zone. */
            displayTimezone: string | null;
            /** @enum {string} */
            locale: "en" | "ru";
        };
        PreferencesStage4Envelope: {
            data: components["schemas"]["PreferencesStage4"];
            meta: components["schemas"]["Meta"];
        };
        ProposalDecisionInput: {
            /** @enum {string} */
            decision: "approve" | "reject";
            reason: string;
            /** Format: uuid */
            reviewedRevisionId: string;
        };
        ProposalReview: {
            /** Format: date-time */
            decidedAt: string;
            /** @enum {string} */
            decision: "approve" | "reject";
            reason: string;
            /** Format: uuid */
            reviewedRevisionId: string;
            /** Format: uuid */
            reviewerId: string;
        };
        /** @description The driver's level limits checked against the trip. decision reads the snapshot stored with the company decision; current checks a pending trip against the level at its attribution time. checked always lists the five rules; event_exempt (company event trip) and no_level list none. */
        QualificationCheck: {
            /** @enum {string} */
            basis: "decision" | "current";
            level: components["schemas"]["QualificationLevelRef"] | null;
            outcome: ("pass" | "fail" | "unknown") | null;
            reasonCode: string | null;
            rules: components["schemas"]["QualificationRuleCheck"][];
            /** @enum {string} */
            status: "checked" | "event_exempt" | "no_level";
        };
        /** @description Promotion conditions on the level. Every set condition must be met. A non-top level needs at least one (422 QUALIFICATION_CONDITIONS_REQUIRED); distance must be positive. */
        QualificationConditions: {
            requiredDistanceM: components["schemas"]["Decimal"] | null;
            requiredTrips: number | null;
        };
        /** @description promotedCount is the number of drivers promoted by the re-check in the same transaction. */
        QualificationLevelCommandResult: {
            level: components["schemas"]["QualificationLevelDetail"];
            promotedCount: number;
        };
        QualificationLevelCreateInput: {
            conditions: components["schemas"]["QualificationConditions"];
            game: components["schemas"]["Game"];
            limits: components["schemas"]["QualificationLimitsInput"];
            name: string;
            position: number;
        };
        QualificationLevelDetail: {
            canManage: boolean;
            conditions: components["schemas"]["QualificationConditions"];
            driverCount: number;
            drivers: components["schemas"]["QualificationLevelDriver"][];
            game: components["schemas"]["Game"];
            history: components["schemas"]["QualificationLevelHistoryEntry"][] | null;
            id: components["schemas"]["Id"];
            levelCount: number;
            limits: components["schemas"]["QualificationLimits"];
            mine: components["schemas"]["MyQualification"] | null;
            name: string;
            nextLevel: components["schemas"]["QualificationLevelRef"] | null;
            position: number;
            version: number;
        };
        QualificationLevelDriver: {
            credited: components["schemas"]["QualificationProgress"];
            /** @description Null when the member's name is no longer available, for example a former member; the client shows a localized label. */
            displayName: string | null;
            memberId: components["schemas"]["Id"];
            since: components["schemas"]["Timestamp"];
        };
        /** @description One level change from the audit log, newest first. legacy marks entries of the earlier ladder model. */
        QualificationLevelHistoryEntry: {
            actor: {
                displayName: string;
                id: components["schemas"]["Id"];
            } | null;
            at: components["schemas"]["Timestamp"];
            changes: ("name" | "limits" | "conditions" | "position")[];
            /** @enum {string} */
            operation: "created" | "edited" | "moved" | "removed" | "legacy";
            position: number | null;
            transferLevel: components["schemas"]["QualificationLevelRef"] | null;
            /** @description The level's values before and after the change; before is null for a created level and after for a removed one. Null on entries recorded without values. */
            values: {
                after: components["schemas"]["QualificationLevelHistoryValues"] | null;
                before: components["schemas"]["QualificationLevelHistoryValues"] | null;
            } | null;
        };
        /** @description A level's name, position, limits and conditions at one point of its history; null position means it was off the ladder. */
        QualificationLevelHistoryValues: {
            conditions: components["schemas"]["QualificationConditions"];
            limits: components["schemas"]["QualificationLimits"];
            name: string;
            position: number | null;
        };
        QualificationLevelList: {
            canManage: boolean;
            game: components["schemas"]["Game"];
            levels: components["schemas"]["QualificationLevelSummary"][];
            mine: components["schemas"]["MyQualification"] | null;
        };
        QualificationLevelMoveInput: {
            expectedVersion: number;
            position: number;
        };
        QualificationLevelRef: {
            id: components["schemas"]["Id"];
            name: string;
        };
        QualificationLevelRemovalInput: {
            expectedVersion: number;
            transferLevelId: components["schemas"]["Id"];
        };
        QualificationLevelRemovalResult: {
            promotedCount: number;
            transferLevel: components["schemas"]["QualificationLevelDetail"];
        };
        QualificationLevelSummary: {
            conditions: components["schemas"]["QualificationConditions"];
            driverCount: number;
            game: components["schemas"]["Game"];
            id: components["schemas"]["Id"];
            limits: components["schemas"]["QualificationLimits"];
            name: string;
            nextLevel: components["schemas"]["QualificationLevelRef"] | null;
            position: number;
            version: number;
        };
        QualificationLevelUpdateInput: {
            conditions: components["schemas"]["QualificationConditions"];
            expectedVersion: number;
            limits: components["schemas"]["QualificationLimitsInput"];
            name: string;
        };
        /** @description Trip limits of a level. Null bounds and the any modes are unset limits. Mass is kilograms and distance is the trip's actual distance in metres; bounds are inclusive. */
        QualificationLimits: {
            adr: {
                classes: ("1" | "2" | "3" | "4" | "6" | "8")[];
                /** @enum {string} */
                mode: "forbidden" | "selected" | "any";
            };
            distanceMaxM: components["schemas"]["Decimal"] | null;
            distanceMinM: components["schemas"]["Decimal"] | null;
            hardModeRequired: boolean;
            massMaxKg: components["schemas"]["Decimal"] | null;
            massMinKg: components["schemas"]["Decimal"] | null;
            trailers: {
                /** @enum {string} */
                mode: "any" | "selected";
                types: components["schemas"]["CatalogLabel"][];
            };
        };
        /** @description The server rejects min above max, a selected mode without items, unknown trailer types and the classes or types of a mode that does not use them. */
        QualificationLimitsInput: {
            adr: {
                classes: ("1" | "2" | "3" | "4" | "6" | "8")[];
                /** @enum {string} */
                mode: "forbidden" | "selected" | "any";
            };
            distanceMaxM: components["schemas"]["Decimal"] | null;
            distanceMinM: components["schemas"]["Decimal"] | null;
            hardModeRequired: boolean;
            massMaxKg: components["schemas"]["Decimal"] | null;
            massMinKg: components["schemas"]["Decimal"] | null;
            trailers: {
                /** @enum {string} */
                mode: "any" | "selected";
                typeIds: components["schemas"]["Id"][];
            };
        };
        QualificationManualChangeInput: {
            levelId: components["schemas"]["Id"];
            reason: string;
        };
        QualificationManualChangeResult: {
            qualification: components["schemas"]["MyQualification"];
        };
        QualificationProgress: {
            distanceM: components["schemas"]["Decimal"];
            trips: number;
        };
        /** @description One of the five level limits applied to the trip with its configured value. An unset limit passes with null bounds or the any mode. Unknown observed values are null, never zero. */
        QualificationRuleCheck: {
            maxKg: components["schemas"]["Decimal"] | null;
            minKg: components["schemas"]["Decimal"] | null;
            observedKg: components["schemas"]["Decimal"] | null;
            /** @enum {string} */
            result: "pass" | "fail" | "unknown";
            /** @constant */
            rule: "cargo_mass";
        } | {
            maxM: components["schemas"]["Decimal"] | null;
            minM: components["schemas"]["Decimal"] | null;
            observedM: components["schemas"]["Decimal"] | null;
            /** @enum {string} */
            result: "pass" | "fail" | "unknown";
            /** @constant */
            rule: "distance";
        } | {
            allowed: components["schemas"]["CatalogLabel"][];
            /** @enum {string} */
            mode: "any" | "selected";
            observed: components["schemas"]["CatalogLabel"][];
            /** @enum {string} */
            result: "pass" | "fail" | "unknown";
            /** @constant */
            rule: "trailer_types";
        } | {
            allowedClasses: ("1" | "2" | "3" | "4" | "6" | "8")[];
            /** @enum {string} */
            mode: "forbidden" | "selected" | "any";
            observed: ("1" | "2" | "3" | "4" | "6" | "8" | "none") | null;
            /** @enum {string} */
            result: "pass" | "fail" | "unknown";
            /** @constant */
            rule: "adr";
        } | {
            observed: ("qualified" | "not-qualified" | "unknown") | null;
            required: boolean;
            /** @enum {string} */
            result: "pass" | "fail" | "unknown";
            /** @constant */
            rule: "hard_mode";
        };
        ReadAllInput: {
            throughCursor: string;
        };
        ReasonInput: {
            reason: string;
        };
        Reconciliation: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            primaryTripId: string;
            primaryVersion: number;
            /** Format: uuid */
            secondaryTripId: string;
            secondaryVersion: number;
            /** @enum {string} */
            state: "applied" | "reversed";
            version: number;
        };
        RedeemInput: {
            invitationToken: string;
            password: string;
        };
        ReinstateInput: {
            assignments: components["schemas"]["AssignmentInput"][];
            reason: string;
            roles: ("trainee" | "driver" | "dispatcher" | "deputy_director")[];
        };
        ReinstatementLevelOption: {
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            name: string;
            position: number;
        };
        ReinstatementOptions: {
            levels: components["schemas"]["ReinstatementLevelOption"][];
        };
        ResolutionChanges: {
            /** Format: date-time */
            actualCompletedAt?: string;
            actualDistanceM?: string;
            /** Format: date-time */
            actualStartAt?: string;
            /** Format: uuid */
            cargoId?: string;
            cargoMassKg?: string;
            /** Format: uuid */
            destinationCityId?: string;
            /** Format: uuid */
            originCityId?: string;
            /** Format: uuid */
            qualificationAssignmentId?: string;
            /** Format: uuid */
            trailerTypeId?: string;
        };
        ResolutionInput: {
            /** Format: date-time */
            actualCompletedAt?: string;
            actualDistanceM?: string;
            /** Format: date-time */
            actualStartAt?: string;
            /** Format: uuid */
            cargoId?: string;
            cargoMassKg?: string;
            /**
             * Format: uuid
             * @description Optional exact pending author correction request; omitted and null are equivalent. Requires an actual supported correction field.
             */
            correctionRequestId?: string | null;
            /** Format: uuid */
            destinationCityId?: string;
            evidenceIds: string[];
            /** Format: uuid */
            originCityId?: string;
            /** Format: uuid */
            qualificationAssignmentId?: string;
            reason: string;
            /** Format: uuid */
            trailerTypeId?: string;
        };
        Review: {
            acceptance: components["schemas"]["ReviewAcceptance"];
            blockedReasonCodes: string[];
            canDecide: boolean;
            evaluation: components["schemas"]["EvaluationSnapshot"];
            /** Format: uuid */
            factRevisionId: string;
            facts: components["schemas"]["SafeSourceFact"][];
            qualificationCheck: components["schemas"]["QualificationCheck"];
            trip: components["schemas"]["TripPrivate"];
        };
        /** @description ordinary: accept without confirmOverLimits. over_limits: only qualification limits failed, the group has no telemetry source and no event exception; accept requires confirmOverLimits true. unavailable: accept returns 409; blockedReasonCodes explain why. Rejection is not limited by this mode, and self-review is reported separately by canDecide. */
        ReviewAcceptance: {
            blockedReasonCodes: string[];
            /** @enum {string} */
            mode: "ordinary" | "over_limits" | "unavailable";
        };
        RolesInput: {
            reason: string;
            roles: ("trainee" | "driver" | "dispatcher" | "deputy_director")[];
        };
        Rsvp: {
            declineReason: string | null;
            /** @enum {string} */
            response: "unanswered" | "participating" | "declined";
            version: number;
        };
        RsvpInput: {
            /** @constant */
            response: "participating";
        } | {
            /** @constant */
            response: "unanswered";
        } | {
            reason: string;
            /** @constant */
            response: "declined";
        };
        SafeErrorDetail: {
            code: string;
            field: string;
            /** Format: uuid */
            ownResourceId?: string;
        };
        SafeSourceFact: {
            candidateEntityIds: string[];
            /** @enum {string} */
            evidenceBasis: "event" | "checkpoint" | "last-known" | "receipt" | "unknown" | "manual";
            /** Format: uuid */
            evidenceRecordId: string;
            /** @enum {string} */
            field: "origin_city" | "destination_city" | "cargo" | "cargo_mass" | "trailer_type" | "actual_distance" | "actual_start" | "actual_completion" | "qualification_assignment";
            mapNamespace: string | null;
            reasonCode: string | null;
            sourceId: string | null;
            sourceLocale: string | null;
            sourceValue: string | null;
        };
        Self: {
            capabilities: string[];
            /** Format: email */
            email: string;
            emailVerified: boolean;
            identityEpoch: number;
            member: components["schemas"]["MemberSummary"];
            missingSetup: string[];
            preferences: components["schemas"]["Preferences"];
            steamVerified: boolean;
        };
        /** @description Self with the Stage 4 nullable display time zone. */
        SelfStage4: {
            capabilities: string[];
            /** Format: email */
            email: string;
            emailVerified: boolean;
            identityEpoch: number;
            member: components["schemas"]["MemberSummary"];
            missingSetup: string[];
            preferences: components["schemas"]["PreferencesStage4"];
            steamVerified: boolean;
        };
        SelfStage4Envelope: {
            data: components["schemas"]["SelfStage4"];
            meta: components["schemas"]["Meta"];
        };
        SourceCapabilities: {
            admissions: boolean;
            externalIdentities: boolean;
            mail: boolean;
            manual: boolean;
            qualifications: boolean;
            sources: components["schemas"]["SourceCapability"][];
            telemetry: boolean;
        };
        SourceCapability: {
            implemented: boolean;
            /** @enum {string} */
            ownership: "personal" | "company";
            /** @enum {string} */
            provider: "ets2telemetry" | "manual" | "trucky" | "vtcbase";
            runtimeEnabled: boolean;
        };
        SourceConnection: {
            /** @enum {string} */
            availability: "available" | "deferred";
            enabled: boolean;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            provider: "ets2telemetry" | "trucky" | "vtcbase";
            version: number;
        };
        SourceConnectionInput: {
            enabled: boolean;
        };
        SteamReplacementInput: {
            reason: string;
            /** Format: uuid */
            verificationId: string;
        };
        SteamReplacementProof: {
            candidateSteamProfileUrl: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** Format: uuid */
            id: string;
            identityEpoch: number;
            /** Format: uuid */
            memberId: string;
            /** @enum {string} */
            state: "pending" | "verified" | "failed" | "expired" | "applied" | "invalidated";
            verifiedAt: string | null;
        };
        SyncStatus: {
            identityEpoch: number;
            lastReceiptAt: string | null;
            pendingReviewTrips: number;
            receivedRecords: number;
        };
        /** Format: date-time */
        Timestamp: string;
        TokenInfo: {
            /** @description Whether this token has the explicitly opted-in companion.own.v1 capability. */
            companion?: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            label: string;
            lastUsedAt: string | null;
            revokedAt: string | null;
        };
        TokenInput: {
            /** @description Explicitly grant own qualification, provisional preview and own-upload result access. Reissue to enable. */
            companion?: boolean;
            label: string;
        };
        TokenIssued: {
            info: components["schemas"]["TokenInfo"];
            token: string;
        };
        TripPrivate: {
            decisions: components["schemas"]["Decision"][];
            effectiveFacts?: components["schemas"]["EffectiveTripFacts"] | null;
            evidence: components["schemas"]["Evidence"][];
            manualRevision: components["schemas"]["ManualRevisionRead"] | null;
            pendingProposalId: string | null;
            qualificationCheck?: components["schemas"]["QualificationCheck"] | null;
            reviewReasonCodes: string[];
            /** @description At most one telemetry source (the selected telemetry fact revision) followed by at most one manual source (the current revision); each can be absent. */
            sources?: components["schemas"]["TripStage4Source"][];
            summary: components["schemas"]["TripSummary"];
            /** @constant */
            view: "private";
        };
        TripProposal: {
            /** Format: uuid */
            authorId: string;
            baseFactRevisionId: string | null;
            baseTripVersion: number;
            changes: components["schemas"]["ResolutionChanges"] | null;
            /**
             * Format: uuid
             * @description Immutable originating author correction request association, when present.
             */
            correctionRequestId?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @description Immutable safe references selected by an event-association proposal. Omitted by older responses; null for proposals without an event association. */
            eventAssociation?: {
                attendanceRevisionId: string | null;
                /** Format: uuid */
                eventId: string;
                /** Format: uuid */
                eventRevisionId: string;
            } | null;
            evidence: components["schemas"]["Evidence"][];
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "correction_request" | "resolution";
            reason: string;
            review: components["schemas"]["ProposalReview"] | null;
            /** Format: uuid */
            revisionId: string;
            /** @enum {string} */
            state: "pending" | "approved" | "rejected";
            /** Format: uuid */
            tripId: string;
        } & unknown;
        /** @description Present only in listTrips responses for scope=review. Review-queue state of the canonical trip: hold flag, stored review reasons, queue time and the current manual revision number (null without a manual report). */
        TripReviewQueueEntry: {
            /** Format: date-time */
            createdAt: string;
            hold: boolean;
            manualRevision: components["schemas"]["TripReviewRevision"] | null;
            reasonCodes: string[];
        };
        TripReviewRevision: {
            number: number;
            /** Format: date-time */
            submittedAt: string;
        };
        TripStage3AcceptInput: {
            confirmOverLimits?: boolean;
            /** @constant */
            decision: "accept";
            /** Format: uuid */
            factRevisionId: string;
            proposalId: null;
            /** @description Omitted or whitespace-only means no staff reason. */
            reason?: string;
            /** Format: uuid */
            reviewedRevisionId: string;
        };
        TripStage3DecisionInput: components["schemas"]["TripStage3AcceptInput"] | components["schemas"]["TripStage3ReturnInput"] | components["schemas"]["TripStage3ProposalDecisionInput"];
        TripStage3Duplicate: {
            createdAt: components["schemas"]["Timestamp"];
            dismissed: boolean;
            game: components["schemas"]["Game"];
            id: components["schemas"]["Id"];
            primaryTrip: components["schemas"]["TripStage3DuplicateTrip"];
            reasonCodes: components["schemas"]["TripStage3ReviewReasonCode"][];
            secondaryTrip: components["schemas"]["TripStage3DuplicateTrip"];
            version: number;
        };
        TripStage3DuplicateDismissal: {
            candidateId: components["schemas"]["Id"];
            dismissed: boolean;
            dismissedAt: components["schemas"]["Timestamp"];
            undoneAt: components["schemas"]["Timestamp"] | null;
            version: number;
        };
        TripStage3DuplicateDismissalEnvelope: {
            data: components["schemas"]["TripStage3DuplicateDismissal"];
            meta: components["schemas"]["Meta"];
        };
        TripStage3DuplicateDismissInput: {
            reason: string;
        };
        TripStage3DuplicateList: {
            items: components["schemas"]["TripStage3Duplicate"][];
            nextCursor: string | null;
            total: number;
        };
        TripStage3DuplicateListEnvelope: {
            data: components["schemas"]["TripStage3DuplicateList"];
            meta: components["schemas"]["Meta"];
        };
        TripStage3DuplicateTrip: {
            actualDistanceM: string | null;
            cargo: components["schemas"]["CatalogLabel"] | null;
            /** @enum {string} */
            decision: "unassessed" | "pending_review" | "accepted" | "rejected";
            destination: components["schemas"]["CatalogLabel"] | null;
            game: components["schemas"]["Game"];
            id: components["schemas"]["Id"];
            number: number;
            origin: components["schemas"]["CatalogLabel"] | null;
            /** @enum {string} */
            outcome: "open" | "delivered" | "cancelled" | "none";
            owner: components["schemas"]["MemberSummary"];
            reportingAt: components["schemas"]["Timestamp"] | null;
            sourceKinds: ("ets2telemetry" | "manual")[];
            version: number;
        };
        TripStage3DuplicateUndoInput: Record<string, never>;
        TripStage3ManualReview: {
            evidence: components["schemas"]["Evidence"][];
            manualRevision: components["schemas"]["ManualRevisionRead"];
        };
        TripStage3ProposalDecisionInput: {
            /** @enum {string} */
            decision: "accept" | "reject";
            /** Format: uuid */
            factRevisionId: string;
            proposalId: components["schemas"]["Id"];
            reason: string;
            /** Format: uuid */
            reviewedRevisionId: string;
        };
        TripStage3ResolvedReviewItem: {
            decidedAt: components["schemas"]["Timestamp"];
            /** @enum {string} */
            outcome: "accepted" | "rejected";
            reasonCodes: components["schemas"]["TripStage3ReviewReasonCode"][];
            /** @constant */
            state: "resolved";
            trip: components["schemas"]["TripStage3ReviewQueueTrip"];
        };
        TripStage3ReturnInput: {
            /** @constant */
            decision: "reject";
            /** Format: uuid */
            factRevisionId: string;
            proposalId: null;
            reason: string;
            /** Format: uuid */
            reviewedRevisionId: string;
        };
        TripStage3Review: {
            acceptance: components["schemas"]["ReviewAcceptance"];
            blockedReasonCodes: string[];
            canDecide: boolean;
            decisions: components["schemas"]["Decision"][];
            effectiveFacts: components["schemas"]["EffectiveTripFacts"] | null;
            evaluation: components["schemas"]["EvaluationSnapshot"];
            /** Format: uuid */
            factRevisionId: string;
            pendingProposalId: string | null;
            qualificationCheck: components["schemas"]["QualificationCheck"];
            reviewReasonCodes: string[];
            sources: {
                manual: components["schemas"]["TripStage3ManualReview"] | null;
                telemetry: components["schemas"]["TripStage3TelemetryReview"] | null;
            };
            summary: components["schemas"]["TripStage3ReviewQueueTrip"];
        };
        TripStage3ReviewEnvelope: {
            data: components["schemas"]["TripStage3Review"];
            meta: components["schemas"]["Meta"];
        };
        TripStage3ReviewItem: components["schemas"]["TripStage3WaitingReviewItem"] | components["schemas"]["TripStage3ResolvedReviewItem"];
        TripStage3ReviewList: {
            items: components["schemas"]["TripStage3ReviewItem"][];
            nextCursor: string | null;
            total: number;
        };
        TripStage3ReviewListEnvelope: {
            data: components["schemas"]["TripStage3ReviewList"];
            meta: components["schemas"]["Meta"];
        };
        TripStage3ReviewQueueTrip: {
            actualDistanceM: string | null;
            cargo: components["schemas"]["CatalogLabel"] | null;
            /** @description UTC canonical trip creation instant. */
            createdAt: components["schemas"]["Timestamp"];
            /** @enum {string} */
            decision: "unassessed" | "pending_review" | "accepted" | "rejected";
            destination: components["schemas"]["CatalogLabel"] | null;
            /** @description Associated visible event, or null if none is visible. Only in authorized author/reviewer projections. Omit entirely in company scope. */
            event?: {
                id: components["schemas"]["Id"];
                title: string;
            } | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /**
             * @description Only in authorized author/reviewer projections. Omit entirely in company scope.
             * @enum {string}
             */
            gameMode?: "single-player" | "truckersmp" | "haulmp" | "unknown";
            /** Format: uuid */
            id: string;
            /** @description Stable canonical trip number when assigned. */
            number: number;
            origin: components["schemas"]["CatalogLabel"] | null;
            /** @enum {string} */
            outcome: "open" | "delivered" | "cancelled" | "none";
            owner: components["schemas"]["MemberSummary"];
            /** @enum {string} */
            recording?: "complete" | "partial" | "unknown";
            reportingAt: string | null;
            /**
             * @description Derived by the server from the persisted effective fact and reporting timestamp, never the collection of source kinds.
             * @enum {string}
             */
            reportingBasis?: "actual_completion" | "manual_confirmation" | "unknown";
            sourceKinds: ("ets2telemetry" | "manual")[];
            /** @description UTC submission instant of the current manual revision, or null when there is no current manual revision. */
            submittedAt?: components["schemas"]["Timestamp"] | null;
            version: number;
            /** @constant */
            view: "summary";
        };
        TripStage3ReviewReasonCode: string;
        TripStage3ReviewSummary: {
            computedAt: components["schemas"]["Timestamp"];
            duplicateCount: number;
            oldestAgeSeconds: number | null;
            oldestQueuedAt: components["schemas"]["Timestamp"] | null;
            waitingCount: number;
        };
        TripStage3ReviewSummaryEnvelope: {
            data: components["schemas"]["TripStage3ReviewSummary"];
            meta: components["schemas"]["Meta"];
        };
        /** @description Comparable normalized fields from the selected telemetry source fact revision. Null denotes an unavailable value. This source provides no normalized depots or companies. */
        TripStage3TelemetryNormalizedFacts: {
            actualCompletedAt: string | null;
            actualDistanceM: components["schemas"]["Decimal"] | null;
            actualStartAt: string | null;
            cargo: components["schemas"]["EffectiveCatalogPin"] | null;
            /** @description Percentage from normalized telemetry damage fraction. Null when the value is unavailable or invalid. */
            cargoDamagePercent: number | null;
            cargoMassKg: components["schemas"]["Decimal"] | null;
            destination: components["schemas"]["EffectiveCatalogPin"] | null;
            /** Format: uuid */
            factRevisionId: string;
            origin: components["schemas"]["EffectiveCatalogPin"] | null;
            plannedDistanceM: components["schemas"]["Decimal"] | null;
            /** @constant */
            provider: "ets2telemetry";
            /** @description Recorded classifications for this telemetry source fact. */
            recordedTelemetry?: {
                /** @enum {string} */
                gameMode: "single-player" | "truckersmp" | "haulmp" | "unknown";
                /** @enum {string} */
                hardModeResult: "qualified" | "not-qualified" | "unknown";
                /** @enum {string} */
                jobType: "quick-job" | "freight-market" | "cargo-market" | "world-of-trucks" | "unknown";
            };
            ruleContextComplete: boolean;
            /** @description Internal source evidence record ID for this normalized fact revision. */
            sourceRecordId: components["schemas"]["Id"];
            trailers: (components["schemas"]["EffectiveCatalogPin"] | null)[];
            trailersComplete: boolean;
            wholeTripDistanceSupported: boolean;
        };
        TripStage3TelemetryReview: {
            /** @description Safe per-field provenance for the selected telemetry source fact revision. */
            facts: components["schemas"]["SafeSourceFact"][];
            normalizedFacts: components["schemas"]["TripStage3TelemetryNormalizedFacts"];
        };
        TripStage3WaitingReviewItem: {
            manualRevision: components["schemas"]["TripReviewRevision"] | null;
            queuedAt: components["schemas"]["Timestamp"];
            reasonCodes: components["schemas"]["TripStage3ReviewReasonCode"][];
            /** @constant */
            state: "waiting";
            trip: components["schemas"]["TripStage3ReviewQueueTrip"];
        };
        /** @description Origin or destination company of the effective fact. Unresolved keeps the raw provider code when one was reported. */
        TripStage4CompanyRef: {
            code: string;
            companyId: components["schemas"]["Id"];
            depotId: components["schemas"]["Id"];
            hidden: boolean;
            logo: components["schemas"]["CatalogLogo"] | null;
            name: string;
            /** @constant */
            state: "resolved";
        } | {
            code: string | null;
            /** @constant */
            state: "unresolved";
        };
        /** @description One author-safe source of the trip. Reconciliation candidates, dismissals, confidence and reasons are reviewer-only and never appear here. */
        TripStage4Source: {
            actualDistanceM: components["schemas"]["Decimal"] | null;
            /** @description True when this source's fact is the trip's current fact or the base of the derived current fact. */
            effective: boolean;
            /** @enum {string} */
            kind: "ets2telemetry" | "manual";
            /** @description Receipt of the selected telemetry source message, or submission of the current manual revision. */
            receivedAt: components["schemas"]["Timestamp"];
            /**
             * @description Persisted outcome of this source's fact.
             * @enum {string}
             */
            state: "open" | "delivered" | "cancelled" | "none";
        };
        TripSummary: {
            actualDistanceM: string | null;
            cargo: components["schemas"]["CatalogLabel"] | null;
            /** @description UTC canonical trip creation instant. */
            createdAt?: components["schemas"]["Timestamp"];
            /** @enum {string} */
            decision: "unassessed" | "pending_review" | "accepted" | "rejected";
            destination: components["schemas"]["CatalogLabel"] | null;
            /** @description Associated visible event, or null if none is visible. Only in authorized author/reviewer projections. Omit entirely in company scope. */
            event?: {
                id: components["schemas"]["Id"];
                title: string;
            } | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /**
             * @description Only in authorized author/reviewer projections. Omit entirely in company scope.
             * @enum {string}
             */
            gameMode?: "single-player" | "truckersmp" | "haulmp" | "unknown";
            /** Format: uuid */
            id: string;
            /** @description Stable canonical trip number when assigned. */
            number?: number;
            origin: components["schemas"]["CatalogLabel"] | null;
            /** @enum {string} */
            outcome: "open" | "delivered" | "cancelled" | "none";
            owner: components["schemas"]["MemberSummary"];
            /** @enum {string} */
            recording?: "complete" | "partial" | "unknown";
            reportingAt: string | null;
            /**
             * @description Derived by the server from the persisted effective fact and reporting timestamp, never the collection of source kinds.
             * @enum {string}
             */
            reportingBasis?: "actual_completion" | "manual_confirmation" | "unknown";
            review?: components["schemas"]["TripReviewQueueEntry"];
            sourceKinds: ("ets2telemetry" | "manual")[];
            /** @description UTC submission instant of the current manual revision, or null when there is no current manual revision. */
            submittedAt?: components["schemas"]["Timestamp"] | null;
            version: number;
            /** @constant */
            view: "summary";
        };
        TripView: components["schemas"]["TripSummary"] | components["schemas"]["TripPrivate"];
        UploadInput: {
            /** Format: binary */
            file: string;
        };
        /** @description Operator technical policy, not company qualification limits or measured capacity. Disabled has null bounds/empty allowlist. Enabled requires configured positive bounds and a nonempty tested image allowlist. MIME/extension alone is insufficient; bounded structural decode, pixel/resource/stream limits and durable private storage are required before ready. See manual-reports.md. */
        UploadPolicy: {
            allowedMimeTypes: string[];
            enabled: boolean;
            maxFileBytes: number | null;
            maxFilesPerReport: number | null;
            policyRevision: number;
        };
        WorkspaceStage3Summary: {
            computedAt: components["schemas"]["Timestamp"];
            /** @description Compatibility summary when Stage 3 dispatch review is disabled and the current viewer has trips.review and an enabled legacy Trips source. Mutually exclusive with reviewQueue. Exclude the viewer's own trips. */
            legacyReviewQueue?: {
                count: number;
                oldestAgeSeconds: number | null;
            };
            /** @description Requires applications.manage and enabled Admissions reads. Count submitted applications. */
            newApplicationsCount?: number;
            /** @description Requires trips.review and enabled review sources. Exclude the viewer's own trips. */
            reviewQueue?: components["schemas"]["TripStage3ReviewSummary"];
            /** @description Requires trips.read_own_private and enabled Trips and Manual Reports reads, including effective rejection data. Include each owned canonical trip once when effectively rejected with an author-resubmittable current manual revision owned by the viewer. Use the latest applicable authoritative staff rejection of that revision in its canonical group. Exclude aliases as rows and ignore historical alias decisions without current effect, telemetry-only and proposal-only rejections, and pending or accepted revisions. A resubmitted pending revision leaves the list until rejected. Sort by applicable decidedAt DESC, then canonical trip ID DESC. Return the author-visible reason or null when no displayable text is available. */
            tripsNeedingFixes?: {
                count: number;
                items: {
                    latestReturnReason: string | null;
                    tripId: components["schemas"]["Id"];
                }[];
            };
            /** @description Requires events.respond and enabled Events reads. Include scheduled events the caller can see and respond to with startsAt strictly after computedAt and either no RSVP or a current unanswered RSVP. Sort by startsAt ASC, then event ID ASC. */
            unansweredUpcomingEvents?: {
                count: number;
                items: {
                    eventId: components["schemas"]["Id"];
                    startsAt: components["schemas"]["Timestamp"];
                    title: string;
                }[];
            };
            /** @description Requires trips.submit_own and enabled Manual Reports reads. Include the caller's editing drafts, ordered by createdAt DESC, then draft ID DESC. */
            unfinishedManualDrafts?: {
                count: number;
                items: {
                    draftId: components["schemas"]["Id"];
                    updatedAt: components["schemas"]["Timestamp"];
                }[];
            };
        };
        WorkspaceStage3SummaryEnvelope: {
            data: components["schemas"]["WorkspaceStage3Summary"];
            meta: components["schemas"]["Meta"];
        };
        /** @description Current permission-filtered workspace snapshot. Omit each section independently if its source is configured off or current authority is missing. An available empty section has count zero and an empty preview where applicable. Transient read failures follow the standard error policy. */
        WorkspaceSummary: {
            computedAt: components["schemas"]["Timestamp"];
            /** @description Requires applications.manage and enabled Admissions reads. Count submitted applications. */
            newApplicationsCount?: number;
            /** @description Requires trips.review and enabled Trips reads. Apply current review visibility and the Awaiting decision predicate (scope=review&hold=true). Exclude the caller's own trips before computing both count and age. Age is the elapsed whole seconds since the oldest eligible TripReviewQueueEntry.createdAt, or null for an empty queue. */
            reviewQueue?: {
                count: number;
                oldestAgeSeconds: number | null;
            };
            /** @description Requires trips.read_own_private and enabled Trips and Manual Reports reads, including effective rejection data. Include each owned canonical trip once when effectively rejected with an author-resubmittable current manual revision owned by the viewer. Use the latest applicable authoritative staff rejection of that revision in its canonical group. Exclude aliases as rows and ignore historical alias decisions without current effect, telemetry-only and proposal-only rejections, and pending or accepted revisions. A resubmitted pending revision leaves the list until rejected. Sort by applicable decidedAt DESC, then canonical trip ID DESC. Return the author-visible reason or null when no displayable text is available. */
            tripsNeedingFixes?: {
                count: number;
                items: {
                    latestReturnReason: string | null;
                    tripId: components["schemas"]["Id"];
                }[];
            };
            /** @description Requires events.respond and enabled Events reads. Include scheduled events the caller can see and respond to with startsAt strictly after computedAt and either no RSVP or a current unanswered RSVP. Sort by startsAt ASC, then event ID ASC. */
            unansweredUpcomingEvents?: {
                count: number;
                items: {
                    eventId: components["schemas"]["Id"];
                    startsAt: components["schemas"]["Timestamp"];
                    title: string;
                }[];
            };
            /** @description Requires trips.submit_own and enabled Manual Reports reads. Include the caller's editing drafts, ordered by createdAt DESC, then draft ID DESC. */
            unfinishedManualDrafts?: {
                count: number;
                items: {
                    draftId: components["schemas"]["Id"];
                    updatedAt: components["schemas"]["Timestamp"];
                }[];
            };
        };
    };
    responses: {
        /** @description Safe application error; HTTP statuses, codes and retry semantics are defined in README.md. */
        Error: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Safe application error; HTTP statuses, codes and retry semantics are defined in README.md. */
        PrivateNoStoreError: {
            headers: {
                /** @description Private response; never cache. */
                "Cache-Control"?: "no-store";
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        Cursor: string;
        IdempotencyKey: string;
        IfMatch: string;
        Limit: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listApplications: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                status?: "submitted" | "approved" | "rejected";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListAdminApplication"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getApplication: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                applicationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeApplication"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    decideApplication: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                applicationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplicationDecisionInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeApplication"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listApplicationHistory: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                applicationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListApplication"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    recheckApplicationTruckersmp: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                applicationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Recheck the applicant on TruckersMP */
            202: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicationStage4TruckersmpCheckEnvelope"];
                };
            };
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
    listAudit: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListAuditEntry"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    createCatalogItem: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                list: "dlcs" | "regions" | "cities" | "companies" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogDlcInput"] | components["schemas"]["CatalogRegionInput"] | components["schemas"]["CatalogCityInput"] | components["schemas"]["CatalogCompanyInput"] | components["schemas"]["CatalogCargoInput"] | components["schemas"]["CatalogTrailerInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogItem"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    updateCatalogItem: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
                list: "dlcs" | "regions" | "cities" | "companies" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogItemPatch"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogItem"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    previewCatalogImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                list: "dlcs" | "regions" | "cities" | "companies" | "depots" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogImportPreview"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    applyCatalogImport: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Quoted dry-run token returned by previewCatalogImport. */
                "If-Match": string;
            };
            path: {
                list: "dlcs" | "regions" | "cities" | "companies" | "depots" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogImportResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    uploadCatalogCompanyLogo: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogItem"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    removeCatalogCompanyLogo: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogItem"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    applyCatalogLogos: {
        parameters: {
            query: {
                game: "ets2" | "ats";
            };
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description Quoted dry-run token returned by previewCatalogLogos. */
                "If-Match": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["CatalogLogoBatchInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogImportResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    previewCatalogLogos: {
        parameters: {
            query: {
                game: "ets2" | "ats";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["CatalogLogoBatchInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogImportPreview"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    createCatalogDepot: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogDepotInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogDepot"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    updateCatalogDepot: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogDepotPatch"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogDepot"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCompanySettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCompanySettings"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    updateCompanySettings: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompanySettingsInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCompanySettings"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listAdminEvents: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                locale?: "en" | "ru";
                period?: "published" | "drafts";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeAdminList"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    createEvent: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEventMember"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    deleteEventDraft: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeDraftDeletion"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            412: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    updateEvent: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEventMember"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getEventAttendance: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListAttendance"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    setEventAttendance: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttendanceInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    cancelEvent: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEventMember"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listAdminEventMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeAdminMediaList"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    uploadEventMedia: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["EventStage2MediaUploadInput"];
            };
        };
        responses: {
            /** @description Staged result; see semantic preconditions. */
            202: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeMediaUpload"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            412: components["responses"]["Error"];
            413: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    deleteEventMedia: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
                mediaId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeAdminMediaList"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            412: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    updateEventMedia: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
                mediaId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventStage2MediaEditInput"];
            };
        };
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeAdminMediaList"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            412: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listEventNonresponders: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeNonresponders"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    publishEventDraft: {
        parameters: {
            query?: {
                locale?: "en" | "ru";
            };
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventStage2PublicationInput"];
            };
        };
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeMember"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            412: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getEventDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeDraft"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    updateEventDraft: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventStage2DraftInput"];
            };
        };
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong version of the aggregate named by this operation. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeDraft"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            412: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listInvitations: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                /** @description Defaults to active. */
                state?: "active" | "expired";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List current invitations */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InvitationStage4ListEnvelope"];
                };
            };
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
    getInvitation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeInvitation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    copyInvitation: {
        parameters: {
            query?: never;
            header: {
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeInvitationLink"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestInvitationEmail: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeInvitation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    reissueInvitation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                invitationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeInvitation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getLeadershipChallengeState: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeLeadershipChallengeState"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestLeadershipChallenge: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadershipChallengeInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeChallenge"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    confirmLeadershipTransfer: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadershipConfirmInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listAdminMembers: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                /** @description Current role. Director matches only the serving director pointer. Filters before pagination; bound into the signed cursor. */
                role?: "trainee" | "driver" | "dispatcher" | "deputy_director" | "director";
                /** @description Case-insensitive nickname substring; surrounding whitespace is ignored and a blank term is rejected. Filters before pagination; bound into the signed cursor. */
                search?: string;
                status?: "active" | "inactive";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListMemberAdmin"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getAdminMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeMemberAdmin"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    deactivateMember: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getAdminMemberIdentity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current authorized safe projection. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeIdentity"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    setMembership: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MembershipInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    changeMemberQualification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                game: components["schemas"]["Game"];
                memberId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualificationManualChangeInput"];
            };
        };
        responses: {
            /** @description Committed result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationManualChangeResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    reinstateMember: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReinstateInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    setRoles: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RolesInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    replaceSteam: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SteamReplacementInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listSteamReplacementProofs: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListSteamReplacementProof"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getSteamReplacementProof: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memberId: string;
                verificationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeSteamReplacementProof"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    createQualificationLevel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualificationLevelCreateInput"];
            };
        };
        responses: {
            /** @description Committed result. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationLevelCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    updateQualificationLevel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                levelId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualificationLevelUpdateInput"];
            };
        };
        responses: {
            /** @description Committed result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationLevelCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    moveQualificationLevel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                levelId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualificationLevelMoveInput"];
            };
        };
        responses: {
            /** @description Committed result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationLevelCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    removeQualificationLevel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                levelId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualificationLevelRemovalInput"];
            };
        };
        responses: {
            /** @description Committed result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationLevelRemovalResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getReinstatementOptions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current authorized safe projection. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeReinstatementOptions"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getSourceCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current authorized safe projection. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeSourceCapabilities"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listSourceConnections: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListSourceConnection"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getSourceConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeSourceConnection"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    updateSourceConnection: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                connectionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SourceConnectionInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeSourceConnection"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCompanyAnalytics: {
        parameters: {
            query?: {
                /** @description Required unless period=all_time; must be absent with it. */
                fromDate?: string;
                game?: "ets2" | "ats";
                granularity?: "day" | "month";
                /** @description range (default) uses fromDate and toDateExclusive. all_time covers every accepted trip without the 732-day limit; fromDate and toDateExclusive must then be absent and the response returns the month-aligned covered range described on the operation. */
                period?: "range" | "all_time";
                /** @description Required unless period=all_time; must be absent with it. */
                toDateExclusive?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalyticsStage4CompanyEnvelope"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCompanyAnalyticsBreakdown: {
        parameters: {
            query: {
                dimension: "route" | "cargo" | "source";
                /** @description Required unless period=all_time; must be absent with it. */
                fromDate?: string;
                game?: "ets2" | "ats";
                /** @description Top items for route and cargo; defaults to 5. Rejected with 422 for source. */
                limit?: number;
                /** @description Label language; defaults to the viewer's saved locale. */
                locale?: "en" | "ru";
                /** @description range (default) uses fromDate and toDateExclusive. all_time covers every accepted trip without the 732-day limit; fromDate and toDateExclusive must then be absent and the response returns the month-aligned covered range described on the operation. */
                period?: "range" | "all_time";
                /** @description Required unless period=all_time; must be absent with it. */
                toDateExclusive?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Company analytics breakdown */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalyticsStage4BreakdownEnvelope"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getLeaderboard: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                /** @description Required unless period=all_time; must be absent with it. */
                fromDate?: string;
                game?: "ets2" | "ats";
                granularity?: "day" | "month";
                limit?: components["parameters"]["Limit"];
                /** @description range (default) uses fromDate and toDateExclusive. all_time covers every accepted trip without the 732-day limit; fromDate and toDateExclusive must then be absent and the response returns the month-aligned covered range described on the operation. */
                period?: "range" | "all_time";
                /** @description Required unless period=all_time; must be absent with it. */
                toDateExclusive?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListLeaderboardEntry"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCsrf: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCsrf"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SelfStage4Envelope"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestPasswordReset: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordResetRequest"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeAcknowledged"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    resetPassword: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordResetInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listCatalogItems: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                dlc?: "base" | string;
                game: "ets2" | "ats";
                /** @description Select rows with their own hidden flag. Takes precedence over includeHidden. */
                hidden?: "only";
                includeHidden?: boolean;
                limit?: components["parameters"]["Limit"];
                locale?: "en" | "ru";
                /** @description Companies list only. Select companies without an uploaded logo. */
                logo?: "missing";
                regionId?: string;
                search?: string;
                /** @description Select rows missing a Russian name. English remains required. Not offered on the dlcs and companies lists, which use only their canonical name (422). */
                untranslated?: true;
            };
            header?: never;
            path: {
                list: "dlcs" | "regions" | "cities" | "companies" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogItemList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogItem: {
        parameters: {
            query?: {
                locale?: "en" | "ru";
            };
            header?: never;
            path: {
                id: string;
                list: "dlcs" | "regions" | "cities" | "companies" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogItem"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogCompanyLogo: {
        parameters: {
            query?: {
                v?: string;
            };
            header?: {
                "If-None-Match"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stored PNG. Strong ETag; Cache-Control is private, max-age=86400 when v is the current version and private, no-cache otherwise. */
            200: {
                headers: {
                    "Cache-Control"?: "private, max-age=86400" | "private, no-cache";
                    /** @description Strong validator: the quoted SHA-256 of the image. */
                    ETag?: string;
                    "X-Content-Type-Options"?: "nosniff";
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                };
            };
            /** @description If-None-Match matches the current image; sent only after authorization. */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listCatalogDepots: {
        parameters: {
            query: {
                cityId?: string;
                companyId?: string;
                cursor?: components["parameters"]["Cursor"];
                depotId?: string;
                dlc?: "base" | string;
                game: "ets2" | "ats";
                /** @description Select rows with their own hidden flag. Takes precedence over includeHidden. */
                hidden?: "only";
                includeHidden?: boolean;
                limit?: components["parameters"]["Limit"];
                locale?: "en" | "ru";
                search?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogDepotList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogSummary: {
        parameters: {
            query: {
                game: "ets2" | "ats";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogSummary"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listEvents: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                period?: "upcoming" | "past";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListEventPublic"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEventMember"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listEventDecliners: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListParticipant"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listEventMedia: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Staged result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventStage2EnvelopeMediaList"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getEventMediaContent: {
        parameters: {
            query: {
                size: "thumb" | "full";
            };
            header?: never;
            path: {
                eventId: string;
                mediaId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized image rendition. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    "X-Content-Type-Options"?: "nosniff";
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getEventResponse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeRsvp"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    setEventResponse: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RsvpInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeRsvp"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listEventParticipants: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListParticipant"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getEventResponseCounts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEventResponseCounts"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    uploadEvidence: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            202: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEvidence"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            413: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getEvidence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                evidenceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEvidence"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    downloadEvidence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                evidenceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized private image bytes; no-store, no-sniff and safe disposition. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Safe attachment disposition; originalName never becomes a filesystem path. */
                    "Content-Disposition"?: string;
                    "X-Content-Type-Options"?: "nosniff";
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            410: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getMailDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                deliveryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Safe delivery evidence; provider acceptance is not inbox receipt. */
            200: {
                headers: {
                    /** @description Strong delivery version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeMailDelivery"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    resendMailDelivery: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                deliveryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Safe delivery evidence; provider acceptance is not inbox receipt. */
            200: {
                headers: {
                    /** @description Strong delivery version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    submitManualReport: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualReportCreationInput"];
            };
        };
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            201: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualReport"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getManualReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reportId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualReport"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listManualReportRevisions: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                reportId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualRevision"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    reviseManualReport: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                reportId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualReportResubmissionInput"];
            };
        };
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualReport"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getManualReportRevision: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reportId: string;
                revisionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualRevision"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    submitManualTrip: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualResolvedInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTripPrivate"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SelfStage4Envelope"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getPersonalConnectionCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current authorized safe projection. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopePersonalConnectionCapabilities"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestCredentialChallenge: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CredentialChallengeInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeChallenge"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    confirmCredentialChange: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CredentialChangeInput"];
            };
        };
        responses: {
            /** @description Password change completed. Email changes never complete at this step. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            /** @description Current channel confirmed; a separate proposed-address proof is pending. Current email remains unchanged and verified. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeChallenge"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getPendingEmailChange: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEmailChangeState"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    confirmProposedEmailChange: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailVerificationInput"];
            };
        };
        responses: {
            /** @description Both proofs succeeded; email replacement and session invalidation committed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestEmailVerification: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeChallenge"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    confirmEmailVerification: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailVerificationInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getIdentity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeIdentity"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listMyManualDrafts: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                /** @description Optional override of the authenticated owner's saved locale for the returned catalog labels, with English fallback for each missing translation. Ordering and the cursor do not depend on it. */
                locale?: "en" | "ru";
                /** @description Limit the list to editing drafts. Omission preserves the existing list. */
                state?: "editing";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualDraft"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    createManualDraft: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualDraftWriteInput"];
            };
        };
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            201: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualDraft"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getMyManualDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualDraft"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    replaceManualDraft: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualDraftWriteInput"];
            };
        };
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualDraft"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    deleteManualDraft: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed draft deletion result, including an authorized exact replay of the same command data. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            400: components["responses"]["PrivateNoStoreError"];
            401: components["responses"]["PrivateNoStoreError"];
            403: components["responses"]["PrivateNoStoreError"];
            /** @description Missing or inaccessible draft. */
            404: components["responses"]["PrivateNoStoreError"];
            /** @description VERSION_CONFLICT for a stale version, STATE_CONFLICT for a submitted draft, or IDEMPOTENCY_CONFLICT for a changed retry. */
            409: components["responses"]["PrivateNoStoreError"];
            422: components["responses"]["PrivateNoStoreError"];
            /** @description Required If-Match header was omitted. */
            428: components["responses"]["PrivateNoStoreError"];
            429: components["responses"]["PrivateNoStoreError"];
            503: components["responses"]["PrivateNoStoreError"];
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
    submitManualDraft: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualDraftFinalSubmissionInput"];
            };
        };
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            201: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualReport"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listMyManualReports: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualReport"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getNotificationPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeNotificationPreferences"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    setNotificationPreferences: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationPreferences"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeNotificationPreferences"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    updatePreferences: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreferencesStage4Envelope"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listMyQualifications: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeMyQualificationList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getSourceSync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeSyncStatus"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestSteamReplacementProof: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeIdentityVerification"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getMySteamReplacementProof: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                verificationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeSteamReplacementProof"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    requestSteamVerification: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeIdentityVerification"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listTelemetryTokens: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListTokenInfo"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    issueTelemetryToken: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTokenIssued"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    revokeTelemetryToken: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                tokenId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getMyTripStatusSummary: {
        parameters: {
            query?: {
                game?: "ets2" | "ats";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeOwnTripStatusSummary"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getUpcomingEvent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeOptionalEvent"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getUploadPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeUploadPolicy"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getMyWorkspaceSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current workspace counts and bounded previews. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeWorkspaceSummary"];
                };
            };
            401: components["responses"]["PrivateNoStoreError"];
            403: components["responses"]["PrivateNoStoreError"];
            503: components["responses"]["PrivateNoStoreError"];
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
    listMembers: {
        parameters: {
            query?: {
                /** @description Current ATS qualification level ID, one of the levels listQualificationLevels returns to this reader for ats; any other ID returns 422. */
                atsLevel?: components["schemas"]["Id"];
                cursor?: components["parameters"]["Cursor"];
                /** @description Current ETS2 qualification level ID, one of the levels listQualificationLevels returns to this reader for ets2; any other ID returns 422. */
                ets2Level?: components["schemas"]["Id"];
                limit?: components["parameters"]["Limit"];
                /** @description Defaults to asc for nickname and desc for the other sorts. Members without an accepted trip sort last for lastTrip in either order. */
                order?: "asc" | "desc";
                /** @description Current role. Director matches only the serving director pointer. Filters before pagination; bound into the signed cursor. */
                role?: "trainee" | "driver" | "dispatcher" | "deputy_director" | "director";
                /** @description Case-insensitive nickname substring; surrounding whitespace is ignored and a blank term is rejected. Same rules as listAdminMembers. Filters before pagination; bound into the signed cursor. */
                search?: string;
                /** @description nickname, 30-day accepted distance, 30-day accepted trips or last accepted trip time. Ties break by member ID. Omitted keeps ascending member ID order. */
                sort?: "nickname" | "distance30d" | "trips30d" | "lastTrip";
                /** @description Membership status: active or former members. Omitted lists both. Filters before pagination and combines with the other filters; bound into the signed cursor. */
                status?: "active" | "former";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberStage4DirectoryListEnvelope"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeMemberProfile"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getMemberAnalytics: {
        parameters: {
            query: {
                fromDate: string;
                game?: "ets2" | "ats";
                granularity?: "day" | "month";
                toDateExclusive: string;
            };
            header?: never;
            path: {
                memberId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeAnalytics"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listMemberQualifications: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                memberId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeMyQualificationList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    pollNotifications: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeNotificationFeed"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    markNotificationRead: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                notificationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listNotificationHistory: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListNotification"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    markNotificationsReadThrough: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReadAllInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    submitApplication: {
        parameters: {
            query?: never;
            header: {
                /** @description A leading ru language range selects Russian transactional mail; otherwise English. The selected locale is retained as transport metadata. */
                "Accept-Language"?: string;
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplicationInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getPublicCompany: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCompanyPublic"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getPublicCompanyStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Company aggregate summary; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Short shared cache for this anonymous aggregate; every error response is no-store. */
                    "Cache-Control"?: "public, max-age=60";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCompanyStatsPublic"];
                };
            };
            409: components["responses"]["Error"];
            422: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listPublicEvents: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                period?: "upcoming" | "past";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListEventPublic"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getPublicEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEventPublic"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getPublicEventCover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized image rendition. */
            200: {
                headers: {
                    /** @description Do not store this response. */
                    "Cache-Control"?: "no-store";
                    "X-Content-Type-Options"?: "nosniff";
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                    "image/png": string;
                };
            };
            404: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    redeemInvitation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RedeemInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listQualificationLevels: {
        parameters: {
            query: {
                game: components["schemas"]["Game"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationLevelList"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getQualificationLevel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                levelId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationLevelDetail"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listReconciliationCandidates: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListMergeCandidate"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    undoReconciliationCandidateDismissal: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                candidateId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TripStage3DuplicateUndoInput"];
            };
        };
        responses: {
            /** @description Undo the current reconciliation candidate dismissal */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TripStage3DuplicateDismissalEnvelope"];
                };
            };
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
    dismissReconciliationCandidate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                candidateId: components["schemas"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TripStage3DuplicateDismissInput"];
            };
        };
        responses: {
            /** @description Dismiss the current reconciliation candidate snapshot */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TripStage3DuplicateDismissalEnvelope"];
                };
            };
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
    reconcileTrips: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeReconciliation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getReconciliation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                reconciliationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeReconciliation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    reverseReconciliation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                reconciliationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MergeReversalInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeReconciliation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listTrips: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                decision?: "unassessed" | "pending_review" | "accepted" | "rejected";
                /** @description Inclusive UTC lower bound on reportingAt. Independent of toExclusive. Trips with unknown reportingAt are excluded whenever a bound is supplied. */
                from?: components["schemas"]["Timestamp"];
                game?: "ets2" | "ats";
                /** @description Review queue only (scope=review): filter by the trip review hold. 422 otherwise. */
                hold?: boolean;
                limit?: components["parameters"]["Limit"];
                /** @description Optional override of the authenticated viewer's saved locale. Use the effective locale for city and cargo search and returned labels, with English fallback for each missing translation. Bind the effective locale into the cursor. */
                locale?: "en" | "ru";
                /** @description Available in every scope. asc/desc sort by createdAt then id in the selected direction. completion_asc/completion_desc sort by known effective actual completion in the selected direction, with missing completion last and id as a stable tie-breaker. */
                order?: "asc" | "desc" | "completion_asc" | "completion_desc";
                /** @description Restrict to the canonical trip owner within authorized visibility. For another owner, only accepted trips can match. */
                ownerId?: components["schemas"]["Id"];
                /** @description Trim surrounding whitespace. Match the localized origin city, destination city or cargo label using the effective locale and per-label English fallback. An all-digit term with an optional leading # matches the exact canonical trip number independently of locale. */
                q?: string;
                scope?: "company" | "mine" | "review";
                /** @description Optional source-kind filter for every scope, using the TripSummary.sourceKinds vocabulary: a trip matches when its canonical group has a source of that kind (a trip with telemetry and a manual report matches both; a trip without sources matches neither). Applied server-side with the scope's visibility rules before keyset paging and bound into the signed cursor. Omitted: no source filter. */
                source?: "ets2telemetry" | "manual";
                /** @description Exclusive UTC upper bound on reportingAt. Independent of from. When both bounds are supplied, from must be earlier than toExclusive. */
                toExclusive?: components["schemas"]["Timestamp"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListTripSummary"];
                };
            };
            /** @description VERSION_CONFLICT when the signed cursor does not match the authorized scope, normalized filters, effective locale or order. */
            409: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getTrip: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTripView"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listTripCorrectionRequests: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualCorrectionRequest"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    requestTripCorrection: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReasonInput"];
            };
        };
        responses: {
            /** @description Committed correction request. CommandResult.id identifies this request, never a proposal; version and ETag identify the updated trip. Discover/read through correction-request GETs. Accepted result is preserved. */
            201: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getTripCorrectionRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                requestId: string;
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative report or draft version; trip-scoped correction reads use the current trip version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualCorrectionRequest"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    decideTrip: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DecisionInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeDecision"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    associateTripEvent: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventAssociationInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listTripManualReports: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed private result; see manual report contract semantics. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualReport"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listManualRevisions: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualRevision"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    reviseManualTrip: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualResolvedInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTripPrivate"];
                };
            };
            400: components["responses"]["Error"];
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            409: components["responses"]["Error"];
            415: components["responses"]["Error"];
            422: components["responses"]["Error"];
            428: components["responses"]["Error"];
            429: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    getManualRevision: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                revisionId: string;
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualRevision"];
                };
            };
            401: components["responses"]["Error"];
            403: components["responses"]["Error"];
            404: components["responses"]["Error"];
            503: components["responses"]["Error"];
            default: components["responses"]["Error"];
        };
    };
    listTripProposals: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListTripProposal"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getTripProposal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                proposalId: string;
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTripProposal"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    decideTripProposal: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                proposalId: string;
                tripId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProposalDecisionInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTripProposalDecision"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listTripReconciliations: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListReconciliation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    proposeTripResolution: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolutionInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCommandResult"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getTripReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tripId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Committed result; see semantic preconditions. */
            200: {
                headers: {
                    /** @description Strong authoritative aggregate version, for the next command. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeReview"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getTripReviewSummary: {
        parameters: {
            query?: {
                game?: components["schemas"]["Game"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Read the waiting review and duplicate totals */
            200: {
                headers: {
                    /** @description Private response; never cache. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TripStage3ReviewSummaryEnvelope"];
                };
            };
            default: components["responses"]["PrivateNoStoreError"];
        };
    };
}
