// The confirmed company event a trip belongs to. Trips within one are credited without the
// level's qualification limits (VTC-157).
export interface ConfirmedEventContext {
  readonly eventId: string;
  readonly eventRevisionId: string;
  readonly attendanceRevisionId: string;
  readonly attendanceStatus?: "confirmed" | "declined" | "unconfirmed";
  readonly prescribedCargoId: string | null;
  readonly prescribedMassKg: string | null;
  readonly prescribedTrailerTypeId: string | null;
}
