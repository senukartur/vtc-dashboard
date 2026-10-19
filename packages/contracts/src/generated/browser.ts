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
    "/api/v1/admin/catalog-import-artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** uploadCatalogArtifact */
        post: operations["uploadCatalogArtifact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-import-artifacts/{artifactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogArtifact */
        get: operations["getCatalogArtifact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-import-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogImportPolicy */
        get: operations["getCatalogImportPolicy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** importCatalog */
        post: operations["importCatalog"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-mappings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** addCatalogMapping */
        post: operations["addCatalogMapping"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-revisions/{revisionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogRevision */
        get: operations["getCatalogRevision"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-revisions/{revisionId}/coverage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listCatalogCoverage */
        get: operations["listCatalogCoverage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-revisions/{revisionId}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listCatalogChanges */
        get: operations["listCatalogChanges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-revisions/{revisionId}/mapping-issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listCatalogMappingIssues */
        get: operations["listCatalogMappingIssues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-revisions/{revisionId}/publication": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** publishCatalog */
        post: operations["publishCatalog"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/catalog-revisions/{revisionId}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogReview */
        get: operations["getCatalogReview"];
        put?: never;
        post?: never;
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
        get?: never;
        put?: never;
        /** publishQualificationRules */
        post: operations["publishQualificationRules"];
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
    "/api/v1/catalogs/entities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listCatalogEntities */
        get: operations["listCatalogEntities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/entities/{entityId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getCatalogEntity */
        get: operations["getCatalogEntity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalogs/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listCatalogRevisions */
        get: operations["listCatalogRevisions"];
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
    "/api/v1/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** uploadEvidence */
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
        /** getEvidence */
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
        /** downloadEvidence */
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
    "/api/v1/manual-trips": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** submitManualTrip */
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
        /** getUploadPolicy */
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
    "/api/v1/operations/{operationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** getOperation */
        get: operations["getOperation"];
        put?: never;
        post?: never;
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
        get?: never;
        put?: never;
        /** requestTripCorrection */
        post: operations["requestTripCorrection"];
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
    "/api/v1/trips/{tripId}/manual-revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** listManualRevisions */
        get: operations["listManualRevisions"];
        put?: never;
        /** reviseManualTrip */
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
        /** getManualRevision */
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
        CatalogArtifact: {
            byteLength: number;
            /** Format: uuid */
            id: string;
            sha256: string;
            /** @enum {string} */
            state: "processing" | "ready" | "rejected";
        };
        CatalogCoveragePack: {
            contributionKinds: ("city" | "region" | "cargo" | "trailer_type" | "trailer_body_type" | "trailer_chain_type" | "adr_category")[];
            packId: string;
            provenance: components["schemas"]["CatalogProvenance"][];
            reasonCodes: string[];
            /** @enum {string} */
            state: "validated" | "missing" | "failed" | "non_contributing";
            title: string;
        };
        CatalogEntity: {
            display: components["schemas"]["CatalogLabel"];
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "city" | "region" | "cargo" | "trailer_type" | "trailer_body_type" | "trailer_chain_type" | "adr_category";
            mapNamespace: string;
            relatedEntityIds: string[];
            /** Format: uuid */
            revisionId: string;
        };
        CatalogEntityChange: {
            /** @enum {string} */
            changeKind: "added" | "changed" | "retired";
            /** Format: uuid */
            entityId: string;
            fields: components["schemas"]["CatalogFieldChange"][];
            /** @enum {string} */
            kind: "city" | "region" | "cargo" | "trailer_type" | "trailer_body_type" | "trailer_chain_type" | "adr_category";
            reasonCodes: string[];
        };
        CatalogFieldChange: {
            after: (string | boolean | number | string[]) | null;
            before: (string | boolean | number | string[]) | null;
            /** @enum {string} */
            field: "label_en" | "label_ru" | "region_id" | "cargo_unit_mass_kg" | "adr_category_id" | "trailer_body_type_id" | "trailer_chain_type_id" | "retired" | "source_mapping";
        };
        CatalogImportInput: {
            /** Format: uuid */
            artifactId: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            sha256: string;
        };
        CatalogLabel: {
            englishFallback: boolean;
            /** Format: uuid */
            entityId: string;
            label: string;
            /** @enum {string} */
            renderedLocale: "en" | "ru";
            /** @enum {string} */
            requestedLocale: "en" | "ru";
            retired: boolean;
        };
        CatalogMappingInput: {
            /** Format: uuid */
            catalogRevisionId: string;
            /** Format: uuid */
            entityId: string;
            /** @enum {string} */
            game: "ets2" | "ats";
            mapNamespace: string;
            provider: string;
            reason: string;
            sourceId: string;
        };
        CatalogMappingIssue: {
            candidateEntityIds: string[];
            /** Format: uuid */
            id: string;
            mapNamespace: string | null;
            provider: string;
            reasonCode: string;
            sourceId: string | null;
            sourceLocale: string | null;
        };
        CatalogProvenance: {
            attribution: string;
            /** Format: date-time */
            observedAt: string;
            permittedUseBasis: string;
            /** Format: uri */
            publicSourceUrl: string;
            /** Format: uuid */
            referenceId: string;
        };
        CatalogReview: {
            addedEntities: number;
            changedEntities: number;
            comparisonRevisionId: string | null;
            expectedPacks: number;
            failedPacks: number;
            gameBuild: string;
            mappingIssues: number;
            missingPacks: number;
            nonContributingPacks: number;
            provenance: components["schemas"]["CatalogProvenance"][];
            /** Format: date */
            releaseInventoryAsOf: string;
            retiredEntities: number;
            /** Format: uuid */
            revisionId: string;
            /** @enum {string} */
            sourceReviewState: "pending" | "approved" | "rejected";
            validatedPacks: number;
            version: number;
        };
        CatalogRevision: {
            coverageComplete: boolean;
            /** Format: date-time */
            createdAt: string;
            englishLabelsComplete: boolean;
            /** @enum {string} */
            game: "ets2" | "ats";
            /** Format: uuid */
            id: string;
            publicationVersion: number;
            sourceReviewComplete: boolean;
            /** @enum {string} */
            state: "draft" | "validated" | "published" | "rejected";
            version: number;
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
            reviewerId: string | null;
        };
        DecisionInput: {
            /** @enum {string} */
            decision: "accept" | "reject";
            /** Format: uuid */
            factRevisionId: string;
            proposalId: string | null;
            reason: string;
            /** Format: uuid */
            reviewedRevisionId: string;
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
        EnvelopeCatalogArtifact: {
            data: components["schemas"]["CatalogArtifact"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogEntity: {
            data: components["schemas"]["CatalogEntity"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogReview: {
            data: components["schemas"]["CatalogReview"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeCatalogRevision: {
            data: components["schemas"]["CatalogRevision"];
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
        EnvelopeListCatalogCoveragePack: {
            data: components["schemas"]["ListCatalogCoveragePack"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListCatalogEntity: {
            data: components["schemas"]["ListCatalogEntity"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListCatalogEntityChange: {
            data: components["schemas"]["ListCatalogEntityChange"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListCatalogMappingIssue: {
            data: components["schemas"]["ListCatalogMappingIssue"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListCatalogRevision: {
            data: components["schemas"]["ListCatalogRevision"];
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
        EnvelopeListQualificationLevel: {
            data: components["schemas"]["ListQualificationLevel"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeListQualificationRuleVersion: {
            data: components["schemas"]["ListQualificationRuleVersion"];
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
        EnvelopeManualRevision: {
            data: components["schemas"]["ManualRevision"];
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
        EnvelopeOperation: {
            data: components["schemas"]["Operation"];
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
        EnvelopeQualificationRuleVersion: {
            data: components["schemas"]["QualificationRuleVersion"];
            meta: components["schemas"]["Meta"];
        };
        EnvelopeReconciliation: {
            data: components["schemas"]["Reconciliation"];
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
            catalogRevisionId: string | null;
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
            originCityId: string | null;
            prescribedCargoId: string | null;
            prescribedMassKg: string | null;
            prescribedTrailerTypeId: string | null;
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
            origin: components["schemas"]["CatalogLabel"] | null;
            /** Format: date-time */
            startsAt: string;
            /** @enum {string} */
            status: "scheduled" | "cancelled" | "completed";
            title: string;
            version: number;
        };
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
             * @description Current safe delivery state from the messaging owner; not_requested means mail was disabled, unavailable means its adapter is not currently configured. Provider acceptance or local simulation never means inbox delivery.
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
        ListCatalogCoveragePack: {
            items: components["schemas"]["CatalogCoveragePack"][];
            nextCursor: string | null;
        };
        ListCatalogEntity: {
            items: components["schemas"]["CatalogEntity"][];
            nextCursor: string | null;
        };
        ListCatalogEntityChange: {
            items: components["schemas"]["CatalogEntityChange"][];
            nextCursor: string | null;
        };
        ListCatalogMappingIssue: {
            items: components["schemas"]["CatalogMappingIssue"][];
            nextCursor: string | null;
        };
        ListCatalogRevision: {
            items: components["schemas"]["CatalogRevision"][];
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
        ListManualRevision: {
            items: components["schemas"]["ManualRevision"][];
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
        ListQualificationLevel: {
            items: components["schemas"]["QualificationLevel"][];
            nextCursor: string | null;
        };
        ListQualificationRuleVersion: {
            items: components["schemas"]["QualificationRuleVersion"][];
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
        ManualInput: {
            actualDistanceM: string;
            /** Format: uuid */
            cargoId: string;
            cargoMassKg: string;
            /** Format: uuid */
            catalogRevisionId: string;
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
        ManualRevision: {
            fields: components["schemas"]["ManualInput"];
            /** Format: uuid */
            id: string;
            number: number;
            /** Format: date-time */
            submittedAt: string;
        };
        MemberAdmin: {
            accessEpoch: number;
            /** Format: email */
            email: string;
            identityEpoch: number;
            profile: components["schemas"]["MemberProfile"];
            /** @enum {string} */
            status: "active" | "inactive";
        };
        MemberProfile: {
            member: components["schemas"]["MemberSummary"];
            qualifications: components["schemas"]["Assignment"][];
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
        Operation: {
            failureCode: string | null;
            /** Format: uuid */
            id: string;
            resultId: string | null;
            /** @enum {string} */
            state: "processing" | "completed" | "failed";
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
            projectionPending: boolean;
            projectionVersion: number;
            requiredDistanceM: string | null;
            requiredTrips: number | null;
            reviewRequired: boolean;
        };
        ProgressPublic: {
            acceptedTrips: number;
            actualDistanceM: string;
            assignment: components["schemas"]["Assignment"];
            /** Format: date-time */
            computedAt: string;
            eligibleForConfirmation: boolean;
            projectionPending: boolean;
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
        PublicationInput: {
            expectedPublicationVersion: number;
            reason: string;
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
        QualificationRuleVersion: {
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
            catalogRevisionId?: string;
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
            /** Format: uuid */
            catalogRevisionId?: string;
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
            blockedReasonCodes: string[];
            canDecide: boolean;
            evaluation: components["schemas"]["EvaluationSnapshot"];
            /** Format: uuid */
            factRevisionId: string;
            facts: components["schemas"]["SafeSourceFact"][];
            trip: components["schemas"]["TripPrivate"];
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
            entityIds: string[];
            /** @constant */
            type: "allowed_adr_categories";
        };
        RulesInput: {
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
            evidence: components["schemas"]["Evidence"][];
            manualRevision: components["schemas"]["ManualRevision"] | null;
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
            /** Format: date-time */
            createdAt: string;
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
            reportingAt: string | null;
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
    uploadCatalogArtifact: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeCatalogArtifact"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogArtifact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artifactId: string;
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
                    "application/json": components["schemas"]["EnvelopeCatalogArtifact"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogImportPolicy: {
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
                    "application/json": components["schemas"]["EnvelopeUploadPolicy"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    importCatalog: {
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
                "application/json": components["schemas"]["CatalogImportInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeOperation"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    addCatalogMapping: {
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
                "application/json": components["schemas"]["CatalogMappingInput"];
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
    getCatalogRevision: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                revisionId: string;
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
                    "application/json": components["schemas"]["EnvelopeCatalogRevision"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listCatalogCoverage: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                reviewVersion: number;
            };
            header?: never;
            path: {
                revisionId: string;
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
                    "application/json": components["schemas"]["EnvelopeListCatalogCoveragePack"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listCatalogChanges: {
        parameters: {
            query: {
                changeKind?: "added" | "changed" | "retired";
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                reviewVersion: number;
            };
            header?: never;
            path: {
                revisionId: string;
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
                    "application/json": components["schemas"]["EnvelopeListCatalogEntityChange"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listCatalogMappingIssues: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
                reviewVersion: number;
            };
            header?: never;
            path: {
                revisionId: string;
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
                    "application/json": components["schemas"]["EnvelopeListCatalogMappingIssue"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    publishCatalog: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                "If-Match": components["parameters"]["IfMatch"];
            };
            path: {
                revisionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublicationInput"];
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
                    "application/json": components["schemas"]["EnvelopeCatalogRevision"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogReview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                revisionId: string;
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
                    "application/json": components["schemas"]["EnvelopeCatalogReview"];
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
    listCatalogEntities: {
        parameters: {
            query: {
                cursor?: components["parameters"]["Cursor"];
                kind: string;
                limit?: components["parameters"]["Limit"];
                locale: "en" | "ru";
                revisionId: string;
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
                    "application/json": components["schemas"]["EnvelopeListCatalogEntity"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    getCatalogEntity: {
        parameters: {
            query: {
                locale: "en" | "ru";
                revisionId: string;
            };
            header?: never;
            path: {
                entityId: string;
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
                    "application/json": components["schemas"]["EnvelopeCatalogEntity"];
                };
            };
            default: components["responses"]["Error"];
        };
    };
    listCatalogRevisions: {
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
                    "application/json": components["schemas"]["EnvelopeListCatalogRevision"];
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEvidence"];
                };
            };
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeEvidence"];
                };
            };
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
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
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
                "application/json": components["schemas"]["ManualInput"];
            };
        };
        responses: {
            /** @description Committed result; see semantic preconditions. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeTripPrivate"];
                };
            };
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeUploadPolicy"];
                };
            };
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
    getOperation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operationId: string;
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
                    "application/json": components["schemas"]["EnvelopeOperation"];
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
                limit?: components["parameters"]["Limit"];
                scope?: "company" | "mine" | "review";
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeListManualRevision"];
                };
            };
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
                "application/json": components["schemas"]["ManualInput"];
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
                    "application/json": components["schemas"]["EnvelopeTripPrivate"];
                };
            };
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnvelopeManualRevision"];
                };
            };
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
                    "application/json": components["schemas"]["EnvelopeDecision"];
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
