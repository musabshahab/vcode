import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Scheduled tasks are gone; their cleanup effect no longer decodes.
  yield* sql`DELETE FROM orchestration_v2_effect_outbox WHERE effect_type = 'scheduled-tasks.cleanup'`;
});
