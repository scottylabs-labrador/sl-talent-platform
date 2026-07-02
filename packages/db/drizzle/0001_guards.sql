-- 0001_guards — the invariants drizzle-kit cannot express: pgvector HNSW
-- indexes, the append-only ledger trigger, the single visibility view, and the
-- seed config rows. The `vector` extension itself is created at the top of
-- 0000 (it must exist before the vector columns), so it is available here.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. pgvector HNSW indexes (cosine) on the three embedding columns.
--    Cosine matches how embeddings are compared in the recruiter longlist.
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "evidence_embedding_hnsw"
  ON "evidence" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experience_stories_embedding_hnsw"
  ON "experience_stories" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_embedding_hnsw"
  ON "jobs" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ledger_events APPEND-ONLY, enforced in the database, not by discipline.
--    Grants can be bypassed by the table owner (Railway hands the app the
--    owner role), so a trigger is the real backstop.
--
--    DELETE is always blocked. UPDATE is blocked EXCEPT the one lawful
--    mutation the right-to-be-forgotten flow needs: anonymizing a row by
--    nulling student_id (optionally writing subject_hash) while leaving every
--    content column byte-identical. That single carve-out is what lets a
--    student hard-delete succeed — the deletion worker runs
--        UPDATE ledger_events
--           SET subject_hash = <salted hash of student_id>, student_id = NULL
--         WHERE student_id = <id>;
--    in one statement (allowed), then deletes the student. It also lets the
--    FK's ON DELETE SET NULL fire without tripping the guard. Any attempt to
--    edit kind/detail/actor/license/created_at, or to re-point student_id to a
--    different value, is rejected as tampering.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "ledger_events_append_only"()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'ledger_events is append-only (DELETE blocked)';
  END IF;
  IF ( NEW."id"         IS DISTINCT FROM OLD."id"
    OR NEW."actor_kind" IS DISTINCT FROM OLD."actor_kind"
    OR NEW."actor_id"   IS DISTINCT FROM OLD."actor_id"
    OR NEW."kind"       IS DISTINCT FROM OLD."kind"
    OR NEW."detail"     IS DISTINCT FROM OLD."detail"
    OR NEW."license"    IS DISTINCT FROM OLD."license"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."student_id" IS NOT NULL ) THEN
    RAISE EXCEPTION 'ledger_events is append-only (only identity anonymization is permitted)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_events_no_update" ON "ledger_events";
--> statement-breakpoint
CREATE TRIGGER "ledger_events_no_update"
  BEFORE UPDATE ON "ledger_events"
  FOR EACH ROW EXECUTE FUNCTION "ledger_events_append_only"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_events_no_delete" ON "ledger_events";
--> statement-breakpoint
CREATE TRIGGER "ledger_events_no_delete"
  BEFORE DELETE ON "ledger_events"
  FOR EACH ROW EXECUTE FUNCTION "ledger_events_append_only"();
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 3. sponsor_visible_students — THE ONE PLACE visibility is enforced.
--    "Another door into the same room, never a bigger room." Web and MCP both
--    read candidates through this view; neither hand-rolls the visibility
--    predicate.
--
--    A student appears here at most once (their LATEST approved dossier on a
--    published screen). Membership + the two boolean columns encode the
--    policy:
--      • visibility = 'paused'      → excluded entirely (never a row).
--      • no approved+published      → excluded entirely (nothing to show yet).
--      • visibility = 'searchable'  → directory_listable = true. Discoverable
--                                     directly (Talent Search, longlist).
--      • visibility = 'match_only'  → directory_listable = false,
--                                     reveal_required = true. Present so a
--                                     shortlist can reference them, but a
--                                     caller must AND against a
--                                     shortlist_entries row with
--                                     reveal_consent = 'granted' before showing
--                                     identity. Directory queries filter these
--                                     out with `WHERE directory_listable`.
--
--    Callers:
--      directory / search   → ... WHERE directory_listable
--      shortlist reveal path → join shortlist_entries se
--                              ON se.student_id = v.student_id
--                             WHERE (v.directory_listable
--                                    OR se.reveal_consent = 'granted')
--    Coaching reports, struck moments, grades, retake history are NOT reachable
--    from this view (no columns, no join path) — by construction.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW "sponsor_visible_students" AS
SELECT DISTINCT ON (s."id")
  s."id"                          AS "student_id",
  s."user_id"                     AS "user_id",
  u."name"                        AS "name",
  s."andrew_id"                   AS "andrew_id",
  s."program"                     AS "program",
  s."grad_date"                   AS "grad_date",
  s."kind"                        AS "kind",
  s."visibility"                  AS "visibility",
  s."locations"                   AS "locations",
  s."work_auth"                   AS "work_auth",
  s."freshness_score"             AS "freshness_score",
  s."last_verified_at"            AS "last_verified_at",
  sc."id"                         AS "screen_id",
  d."id"                          AS "dossier_id",
  d."status"                      AS "dossier_status",
  d."approved_at"                 AS "dossier_approved_at",
  (s."visibility" = 'searchable') AS "directory_listable",
  (s."visibility" = 'match_only') AS "reveal_required"
FROM "students" s
JOIN "users"    u  ON u."id" = s."user_id"
JOIN "screens"  sc ON sc."student_id" = s."id" AND sc."status" = 'published'
JOIN "dossiers" d  ON d."screen_id" = sc."id" AND d."status" = 'approved'
WHERE s."visibility" IN ('searchable', 'match_only')
ORDER BY s."id", d."approved_at" DESC NULLS LAST;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Seed config (autonomy levels, SLA hours, rubric + prompt versions,
--    recruiter pipeline knobs). ON CONFLICT DO NOTHING so a re-apply or a
--    later seed() never clobbers ops-edited values. Mirrors CONFIG_DEFAULTS
--    in src/seed.ts.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO "config" ("key", "value", "version") VALUES
  ('autonomy',
   '{"rep":"B","synthesizer":"B","verifier":"C","recruiter":"B","concierge":"B","coach":"C","sentinel":"C"}'::jsonb,
   1),
  ('sla_hours', '{"hours":72}'::jsonb, 1),
  ('rubric_version', '{"version":"v0.1"}'::jsonb, 1),
  ('prompt_versions',
   '{"rep":"v0.1","synthesizer":"v0.1","verifier":"v0.1","recruiter":"v0.1","concierge":"v0.1","coach":"v0.1","sentinel":"v0.1"}'::jsonb,
   1),
  ('recruiter_pipeline',
   '{"longlist":30,"slate":10,"fits":8,"confidenceThreshold":0.72,"gateFirstShortlistForOrg":true}'::jsonb,
   1)
ON CONFLICT ("key") DO NOTHING;
