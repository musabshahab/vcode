import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Guest links are gone. Their events carry the whole thread, like a metadata update.
  yield* sql`
    UPDATE orchestration_events
    SET event_type = 'thread.metadata-updated'
    WHERE event_type = 'thread.guest-share-updated'
  `;
});
