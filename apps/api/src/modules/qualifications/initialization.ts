import { newId, type TxContext, type UnitOfWork } from "@vtc/db";
import { initialQualifications } from "@vtc/db/qualifications-schema";

export function createQualificationInitialization(unit: UnitOfWork) {
  return {
    async initialize(
      tx: TxContext,
      input: { userId: string; games: readonly ("ets2" | "ats")[]; assignedAt: string },
    ) {
      if (
        !input.games.length ||
        new Set(input.games).size !== input.games.length ||
        input.games.some((g) => !["ets2", "ats"].includes(g))
      )
        throw new Error("INVALID_INITIAL_GAMES");
      await unit
        .client(tx)
        .insert(initialQualifications)
        .values(
          input.games.map((game) => ({
            id: newId(),
            userId: input.userId,
            game,
            level: "trainee" as const,
            assignedAt: input.assignedAt,
          })),
        );
    },
  };
}
