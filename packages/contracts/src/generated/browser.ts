// Generated from the reviewed OpenAPI. Do not edit by hand.
export interface paths {
    "/api/v1/admin/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listApplications */
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
         * @description Dry-run of one CSV or JSON file (8 MiB). Writes nothing. The returned token authorizes applying exactly these bytes by this actor for 30 minutes and is null when any line has an error.
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
        get?: never;
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
        delete?: never;
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
        /** listAdminMembers */
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
    "/api/v1/admin/members/{memberId}/promotions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** confirmPromotion */
        post: operations["confirmPromotion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/qualification-action-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read staff-only recorded qualification action attribution and effective intervals */
        get: operations["listQualificationActionHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/qualification-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listMemberQualificationAssignments */
        get: operations["listMemberQualificationAssignments"];
        put?: never;
        /** assignQualification */
        post: operations["assignQualification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/members/{memberId}/qualification-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getAdminQualificationProgress */
        get: operations["getAdminQualificationProgress"];
        put?: never;
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
    "/api/v1/admin/qualification-levels/{levelId}": {
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
        /** renameQualificationLevel */
        patch: operations["renameQualificationLevel"];
        trace?: never;
    };
    "/api/v1/admin/qualification-levels/{levelId}/rule-versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read staff-only immutable rule history with recorded publisher */
        get: operations["listQualificationRuleHistory"];
        put?: never;
        /** publishQualificationRules */
        post: operations["publishQualificationRules"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/qualification-members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List named qualification targets, including former members */
        get: operations["listQualificationMembers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/qualification-rule-previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Evaluate hypothetical facts against a draft without publishing */
        post: operations["previewQualificationRules"];
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
        /** getCompanyAnalytics */
        get: operations["getCompanyAnalytics"];
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
        /** getLeaderboard */
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
        /** listCatalogItems */
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
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
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
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
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
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        get: operations["listMyManualDrafts"];
        put?: never;
        /**
         * createManualDraft
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
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
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
         */
        put: operations["replaceManualDraft"];
        post?: never;
        delete?: never;
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
         * @description VTC-025 contract; see manual-reports.md for coordinated compatibility, authority, concurrency, upload and retention semantics. Runtime implementation is a separate gate.
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
    "/api/v1/me/qualification-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listMyQualificationAssignments */
        get: operations["listMyQualificationAssignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/qualification-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getMyQualificationProgress */
        get: operations["getMyQualificationProgress"];
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
    "/api/v1/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listMembers */
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
    "/api/v1/members/{memberId}/qualification-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getQualificationProgress */
        get: operations["getQualificationProgress"];
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
        /** listQualificationLevels */
        get: operations["listQualificationLevels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/qualification-levels/{levelId}/rule-versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listQualificationRuleVersions */
        get: operations["listQualificationRuleVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/qualification-levels/{levelId}/rule-versions/{ruleVersionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getQualificationRuleVersion */
        get: operations["getQualificationRuleVersion"];
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
        /** listTrips */
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
    "/api/v1/trips/{tripId}/qualification-assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listTripQualificationAssignments */
        get: operations["listTripQualificationAssignments"];
        put?: never;
        post?: never;
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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Acknowledged: {
            /** @constant */
            status: "received";
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
            /** Format: uri */
            steamProfileUrl: string;
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
            /** Format: uuid */
            periodId: string;
        };
        AssignmentInput: {
            /**
             * Format: date-time
             * @description Supported historical interval start, required only for historical_resolution.
             */
            assignedAt?: string;
            /**
             * Format: date-time
             * @description Supported exclusive historical interval end, required only for historical_resolution.
             */
            endedAt?: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            levelId: string;
            /** @enum {string} */
            purpose: "initial" | "reinstatement" | "historical_resolution" | "administrative_correction";
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
        CatalogDlcInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            nameEn: string;
            nameRu?: string | null;
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
        /** @description One row of a catalog list. steamAppId is present only on dlcs, regionId and region only on cities, adrClass only on cargoes. On the trailers list, code is the telemetry body type. */
        CatalogItem: {
            adrClass?: ("1" | "2" | "3" | "4" | "6" | "8") | null;
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
            display: components["schemas"]["CatalogLabel"];
            dlc: components["schemas"]["CatalogLabel"] | null;
            dlcId: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            hidden: boolean;
            /** Format: uuid */
            id: string;
            nameEn: string;
            /** @description The city's canonical name. Present only on the cities list. */
            nameNative?: string | null;
            nameRu: string | null;
            region?: components["schemas"]["CatalogLabel"] | null;
            regionId?: string | null;
            steamAppId?: number | null;
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
            dlcId?: string | null;
            hidden?: boolean;
            nameEn?: string;
            nameNative?: string | null;
            nameRu?: string | null;
            regionId?: string | null;
            steamAppId?: number | null;
        };
        CatalogLabel: {
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
                    visible: number;
                };
                cities: {
                    hidden: number;
                    visible: number;
                };
                dlcs: {
                    hidden: number;
                    visible: number;
                };
                regions: {
                    hidden: number;
                    visible: number;
                };
                trailers: {
                    hidden: number;
                    visible: number;
                };
            };
        };
        CatalogTrailerInput: {
            /** @description Opaque per-game telemetry code; compared byte-exact and never rewritten. */
            code: string;
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
            cargoMassKg: components["schemas"]["Decimal"] | null;
            destination: components["schemas"]["EffectiveCatalogPin"] | null;
            /** Format: uuid */
            factRevisionId: string;
            origin: components["schemas"]["EffectiveCatalogPin"] | null;
            plannedDistanceM: components["schemas"]["Decimal"] | null;
            /** @enum {string} */
            provider: "manual" | "ets2telemetry";
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
        EnvelopeAssignment: {
            data: components["schemas"]["Assignment"];
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
        EnvelopeListApplication: {
            data: components["schemas"]["ListApplication"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListAssignmentHistory: {
            data: components["schemas"]["ListAssignmentHistory"];
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
        EnvelopeListQualificationActionHistory: {
            data: components["schemas"]["ListQualificationActionHistory"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListQualificationLevel: {
            data: components["schemas"]["ListQualificationLevel"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListQualificationRuleHistory: {
            data: components["schemas"]["ListQualificationRuleHistory"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListQualificationRuleVersion: {
            data: components["schemas"]["ListQualificationRuleVersion"];
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
        EnvelopeProgress: {
            data: components["schemas"]["Progress"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeProgressPublic: {
            data: components["schemas"]["ProgressPublic"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationLevel: {
            data: components["schemas"]["QualificationLevel"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationPreview: {
            data: components["schemas"]["QualificationPreview"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeQualificationRuleVersion: {
            data: components["schemas"]["QualificationRuleVersion"];
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
            ruleVersionId: string | null;
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
        LeaderboardEntry: {
            acceptedTrips: number;
            actualDistanceM: string;
            member: components["schemas"]["MemberSummary"];
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
        LevelInput: {
            name: string;
        };
        ListApplication: {
            items: components["schemas"]["Application"][];
            nextCursor: string | null;
        };
        ListAssignmentHistory: {
            items: components["schemas"]["AssignmentHistory"][];
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
            items: components["schemas"]["LeaderboardEntry"][];
            nextCursor: string | null;
        };
        ListManualCorrectionRequest: {
            items: components["schemas"]["ManualCorrectionRequest"][];
            nextCursor: string | null;
        };
        ListManualDraft: {
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
        ListQualificationActionHistory: {
            items: components["schemas"]["QualificationActionHistory"][];
            nextCursor: string | null;
        };
        ListQualificationLevel: {
            items: components["schemas"]["QualificationLevel"][];
            nextCursor: string | null;
        };
        ListQualificationRuleHistory: {
            items: components["schemas"]["QualificationRuleHistory"][];
            nextCursor: string | null;
        };
        ListQualificationRuleVersion: {
            items: components["schemas"]["QualificationRuleVersion"][];
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
        };
        LoginInput: {
            /** Format: email */
            email: string;
            password: string;
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
        /** @description Owner-only durable draft. No source/canonical trip exists before submission; a successful submission freezes this draft and retains a discoverable submittedReportId. */
        ManualDraft: {
            /** Format: date-time */
            createdAt: string;
            fields: components["schemas"]["ManualDraftFields"];
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state: "editing" | "submitted";
            submittedReportId: string | null;
            targetTrip: components["schemas"]["ManualTelemetryTarget"] | null;
            /** Format: date-time */
            updatedAt: string;
            version: number;
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
        ManualDraftInput: {
            fields: components["schemas"]["ManualDraftFields"];
            targetTrip?: components["schemas"]["ManualTelemetryTarget"] | null;
        };
        /** @description Complete final fields replace partial draft fields in the same guarded submission. Draft target is retained; update the draft with a fresh telemetry target version before retrying a stale target. */
        ManualDraftSubmission: {
            fields: components["schemas"]["ManualSubmissionFields"];
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
        ManualReportRevision: {
            fields: components["schemas"]["ManualReportFields"];
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
            member: components["schemas"]["MemberSummary"];
            qualifications: components["schemas"]["Assignment"][];
        };
        MembershipInput: {
            /** @enum {string} */
            membership: "trainee" | "driver";
            reason: string;
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
        NotificationPreferences: {
            eventChanges: boolean;
            eventReminders: boolean;
            qualificationChanges: boolean;
            tripFinished: boolean;
            tripRejected: boolean;
            tripStarted: boolean;
        };
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
            displayTimezone?: string;
            /** @enum {string} */
            locale?: "en" | "ru";
        };
        Progress: {
            acceptedTrips: number;
            actualDistanceM: string;
            assignment: components["schemas"]["Assignment"];
            /** Format: date-time */
            computedAt: string;
            eligibleForConfirmation: boolean;
            /** @constant */
            projectionPending: false;
            projectionVersion: number;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
            reviewReasonCodes: "promotion_requirements_no_longer_met"[];
            reviewRequired: boolean;
        };
        ProgressPublic: {
            acceptedTrips: number;
            actualDistanceM: string;
            assignment: components["schemas"]["Assignment"];
            /** Format: date-time */
            computedAt: string;
            eligibleForConfirmation: boolean;
            /** @constant */
            projectionPending: false;
            projectionVersion: number;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
        };
        PromotionInput: {
            /** Format: uuid */
            assignmentId: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            reason: string;
            /** Format: uuid */
            targetLevelId: string;
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
        QualificationActionActor: {
            /** Format: uuid */
            id: string;
            nickname: string | null;
        };
        QualificationActionHistory: {
            actor: components["schemas"]["QualificationActionActor"] | null;
            /** Format: date-time */
            assignedAt: string;
            endedAt: string | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            levelId: string;
            /** Format: uuid */
            periodId: string;
            promotion: {
                /** Format: date-time */
                confirmedAt: string;
                /** Format: uuid */
                id: string;
            } | null;
            /** @enum {string} */
            purpose: "initial" | "reinstatement" | "historical_resolution" | "administrative_correction" | "promotion";
        };
        /** @description Historical qualification rules evaluated for the reviewed fact. Unresolved history has a reason code and no rules. */
        QualificationCheck: {
            reasonCode: string | null;
            rules: components["schemas"]["QualificationRuleCheck"][];
            /** @enum {string} */
            status: "resolved" | "unresolved";
        };
        QualificationLevel: {
            /** @enum {string} */
            code: "trainee" | "driver_iii" | "driver_ii" | "driver_i";
            configured: boolean;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            name: string;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
            ruleVersionId: string | null;
            version: number;
        };
        QualificationPreview: {
            /** @enum {string} */
            outcome: "pass" | "fail" | "unknown";
            ruleResults: {
                /** @enum {string} */
                outcome: "pass" | "fail" | "unknown";
                /** @enum {string} */
                reasonCode: "rule_passed" | "rule_mass_exceeded" | "rule_mass_unknown" | "rule_mass_invalid" | "rule_trailer_type_disallowed" | "rule_trailer_type_unknown" | "rule_trailers_incomplete" | "rule_adr_category_disallowed" | "rule_adr_category_unknown";
                /** @enum {string} */
                ruleType: "max_mass" | "allowed_trailer_types" | "allowed_adr_categories";
            }[];
        };
        QualificationPreviewInput: {
            /** @enum {string} */
            game: "ets2" | "ats";
            rules: components["schemas"]["Rule"][];
            sample: {
                adr: {
                    adrClass: ("1" | "2" | "3" | "4" | "6" | "8") | null;
                    /** @enum {string} */
                    status: "known" | "non_hazardous" | "unknown";
                };
                cargoMassKg: string | null;
                trailersComplete: boolean;
                trailerTypeIds: (string | null)[];
            };
        };
        /** @description One historical qualification rule applied to the reviewed fact. Mass values are kilograms (max_mass only); entityIds lists up to 10 trailer catalog IDs or ADR classes that broke the rule. Unknown values are null, never zero. */
        QualificationRuleCheck: {
            bypassedByEvent: boolean;
            entityIds: (string | ("1" | "2" | "3" | "4" | "6" | "8"))[];
            limitMassKg: components["schemas"]["Decimal"] | null;
            observedMassKg: components["schemas"]["Decimal"] | null;
            /** @enum {string} */
            outcome: "pass" | "fail" | "unknown";
            reasonCode: string;
            ruleType: string;
        };
        QualificationRuleHistory: {
            /** Format: date-time */
            effectiveAt: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            levelId: string;
            /** Format: date-time */
            publishedAt: string;
            publisher: components["schemas"]["QualificationActionActor"] | null;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
            rules: components["schemas"]["Rule"][];
        };
        QualificationRuleVersion: {
            /** Format: date-time */
            effectiveAt: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            levelId: string;
            /** Format: date-time */
            publishedAt: string;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
            rules: components["schemas"]["Rule"][];
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
            code: "trainee" | "driver_iii" | "driver_ii" | "driver_i";
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            name: string;
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
        Rule: {
            maxKg: string;
            /** @constant */
            type: "max_mass";
        } | {
            entityIds: string[];
            /** @constant */
            type: "allowed_trailer_types";
        } | {
            classes: ("1" | "2" | "3" | "4" | "6" | "8")[];
            /** @constant */
            type: "allowed_adr_categories";
        };
        RulesInput: {
            /**
             * Format: date-time
             * @description Omit for immediate publication. Supplied effective time must be at or after server publication and later than every existing effective version. Retroactive publication is rejected.
             */
            effectiveAt?: string;
            reason: string;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
            rules: components["schemas"]["Rule"][];
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
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            label: string;
            lastUsedAt: string | null;
            revokedAt: string | null;
        };
        TokenInput: {
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
            reviewReasonCodes: string[];
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
        TripSummary: {
            actualDistanceM: string | null;
            cargo: components["schemas"]["CatalogLabel"] | null;
            /** @enum {string} */
            decision: "unassessed" | "pending_review" | "accepted" | "rejected";
            destination: components["schemas"]["CatalogLabel"] | null;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
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
                    "application/json": components["schemas"]["EnvelopeListApplication"];
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
                list: "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CatalogDlcInput"] | components["schemas"]["CatalogRegionInput"] | components["schemas"]["CatalogCityInput"] | components["schemas"]["CatalogCargoInput"] | components["schemas"]["CatalogTrailerInput"];
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
                list: "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
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
                list: "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
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
                list: "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
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
    confirmPromotion: {
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
                "application/json": components["schemas"]["PromotionInput"];
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
                    "application/json": components["schemas"]["EnvelopeAssignment"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listQualificationActionHistory: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                game: "ets2" | "ats";
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
            /** @description Recorded purpose and actor, exact promotion proof relation; no private rationale or invented recorded timestamp. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListQualificationActionHistory"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listMemberQualificationAssignments: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                game: "ets2" | "ats";
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
                    "application/json": components["schemas"]["EnvelopeListAssignmentHistory"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    assignQualification: {
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
                "application/json": components["schemas"]["AssignmentInput"];
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
                    "application/json": components["schemas"]["EnvelopeAssignment"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getAdminQualificationProgress: {
        parameters: {
            query: {
                game: "ets2" | "ats";
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
                    "application/json": components["schemas"]["EnvelopeProgress"];
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
    renameQualificationLevel: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                levelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LevelInput"];
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
                    "application/json": components["schemas"]["EnvelopeQualificationLevel"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listQualificationRuleHistory: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                levelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Immutable versions and recorded publisher with current safe nickname. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListQualificationRuleHistory"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    publishQualificationRules: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                levelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RulesInput"];
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
                    "application/json": components["schemas"]["EnvelopeQualificationLevel"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listQualificationMembers: {
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
            /** @description Bounded member summaries ordered by exact ascending ID. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListMemberSummary"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    previewQualificationRules: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualificationPreviewInput"];
            };
        };
        responses: {
            /** @description Hypothetical qualification outcome only; no company acceptance or event authority. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeQualificationPreview"];
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
            query: {
                fromDate: string;
                game?: "ets2" | "ats";
                granularity?: "day" | "month";
                toDateExclusive: string;
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
                    "application/json": components["schemas"]["EnvelopeAnalytics"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getLeaderboard: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                fromDate: string;
                game?: "ets2" | "ats";
                granularity?: "day" | "month";
                limit?: components["parameters"]["Limit"];
                toDateExclusive: string;
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
                    "application/json": components["schemas"]["EnvelopeSelf"];
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
                includeHidden?: boolean;
                limit?: components["parameters"]["Limit"];
                locale?: "en" | "ru";
                regionId?: string;
                search?: string;
            };
            header?: never;
            path: {
                list: "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
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
                list: "dlcs" | "regions" | "cities" | "cargoes" | "trailers";
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
                "application/json": components["schemas"]["ManualReportInput"];
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
                "application/json": components["schemas"]["ManualReportRevisionInput"];
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
                    "application/json": components["schemas"]["EnvelopeSelf"];
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
                "application/json": components["schemas"]["ManualDraftInput"];
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
                "application/json": components["schemas"]["ManualDraftInput"];
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
                "application/json": components["schemas"]["ManualDraftSubmission"];
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
                    "application/json": components["schemas"]["EnvelopePreferences"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listMyQualificationAssignments: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                game: "ets2" | "ats";
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
                    "application/json": components["schemas"]["EnvelopeListAssignmentHistory"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getMyQualificationProgress: {
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
                    "application/json": components["schemas"]["EnvelopeProgress"];
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
    listMembers: {
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
                    "application/json": components["schemas"]["EnvelopeListMemberSummary"];
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
    getQualificationProgress: {
        parameters: {
            query: {
                game: "ets2" | "ats";
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
                    "application/json": components["schemas"]["EnvelopeProgressPublic"];
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
                cursor?: components["parameters"]["Cursor"];
                game: "ets2" | "ats";
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
                    "application/json": components["schemas"]["EnvelopeListQualificationLevel"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listQualificationRuleVersions: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                levelId: string;
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
                    "application/json": components["schemas"]["EnvelopeListQualificationRuleVersion"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getQualificationRuleVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                levelId: string;
                ruleVersionId: string;
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
                    "application/json": components["schemas"]["EnvelopeQualificationRuleVersion"];
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
                game?: "ets2" | "ats";
                /** @description Review queue only (scope=review): filter by the trip review hold. 422 otherwise. */
                hold?: boolean;
                limit?: components["parameters"]["Limit"];
                /** @description Review queue only (scope=review): createdAt then id order; default desc. 422 otherwise. Cursors are bound to hold and order. */
                order?: "asc" | "desc";
                scope?: "company" | "mine" | "review";
                /** @description Optional source-kind filter for every scope, using the TripSummary.sourceKinds vocabulary: a trip matches when its canonical group has a source of that kind (a trip with telemetry and a manual report matches both; a trip without sources matches neither). Applied server-side with the scope's visibility rules before keyset paging and bound into the signed cursor. Omitted: no source filter. */
                source?: "ets2telemetry" | "manual";
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
    listTripQualificationAssignments: {
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
                    "application/json": components["schemas"]["EnvelopeListAssignmentHistory"];
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
}
