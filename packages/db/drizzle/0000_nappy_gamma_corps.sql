-- pgvector must exist before any vector(1536) column below (evidence,
-- experience_stories, jobs). Prepended by hand: drizzle-kit does not emit the
-- extension. Idempotent, so re-running the migration is safe.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."agent_name" AS ENUM('rep', 'synthesizer', 'verifier', 'recruiter', 'concierge', 'coach', 'sentinel');--> statement-breakpoint
CREATE TYPE "public"."dossier_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('fit', 'wildcard', 'alum', 'match_only');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('none', 'intro', 'passed', 'saved');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('repo', 'paper', 'demo', 'hackathon', 'course', 'work', 'interview_moment');--> statement-breakpoint
CREATE TYPE "public"."exception_category" AS ENUM('verification_conflict', 'low_confidence_shortlist', 'policy_refusal', 'sla_risk', 'student_report', 'consent_edge');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('open', 'approved', 'overridden', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('intake', 'confirmed', 'matching', 'delivered', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ledger_actor_kind" AS ENUM('sponsor', 'agent', 'system', 'student');--> statement-breakpoint
CREATE TYPE "public"."ledger_event_kind" AS ENUM('view', 'search_hit', 'shortlist', 'export', 'stream', 'verify', 'edit');--> statement-breakpoint
CREATE TYPE "public"."outcome_stage" AS ENUM('intro', 'interview', 'offer', 'hire', 'pass');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('verified', 'self_reported', 'pending');--> statement-breakpoint
CREATE TYPE "public"."reveal_consent" AS ENUM('n/a', 'requested', 'granted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."screen_status" AS ENUM('scheduled', 'live', 'processing', 'review', 'published', 'struck');--> statement-breakpoint
CREATE TYPE "public"."shortlist_status" AS ENUM('assembling', 'human_gate', 'delivered', 'rerun');--> statement-breakpoint
CREATE TYPE "public"."sponsor_member_role" AS ENUM('recruiter', 'hiring_manager', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sponsor_tier" AS ENUM('premier', 'community');--> statement-breakpoint
CREATE TYPE "public"."student_kind" AS ENUM('undergrad', 'grad', 'alum');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'sponsor', 'operator');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('searchable', 'match_only', 'paused');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" "agent_name" NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_ref" text,
	"output" jsonb,
	"confidence" double precision,
	"cost_usd" numeric(12, 6),
	"tokens" integer,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"status" "dossier_status" DEFAULT 'draft' NOT NULL,
	"competency" jsonb,
	"flags" jsonb,
	"followups" jsonb,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"provenance" "provenance" DEFAULT 'self_reported' NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"meta" jsonb,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "exception_category" NOT NULL,
	"agent" "agent_name",
	"context" jsonb,
	"recommendation" text,
	"status" "exception_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experience_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"title" text NOT NULL,
	"situation" text NOT NULL,
	"contribution" text NOT NULL,
	"outcome" text,
	"meta" jsonb,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'intake' NOT NULL,
	"title" text NOT NULL,
	"jd_raw" text,
	"requirements" jsonb,
	"calibration" jsonb,
	"comp_range" jsonb NOT NULL,
	"embedding" vector(1536),
	"confirmed_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid,
	"subject_hash" text,
	"actor_kind" "ledger_actor_kind" NOT NULL,
	"actor_id" text,
	"kind" "ledger_event_kind" NOT NULL,
	"detail" jsonb,
	"license" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"stage" "outcome_stage" NOT NULL,
	"logged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen_moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"screen_id" uuid NOT NULL,
	"t_start_ms" integer NOT NULL,
	"t_end_ms" integer NOT NULL,
	"tag" text NOT NULL,
	"quote" text NOT NULL,
	"rep_note" text,
	"clip_key" text,
	"student_visible" boolean DEFAULT true NOT NULL,
	"struck" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "screen_status" DEFAULT 'scheduled' NOT NULL,
	"consent_app_at" timestamp with time zone,
	"consent_verbal_span" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"retake_of" uuid,
	"audio_key" text,
	"transcript" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shortlist_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"fit" integer NOT NULL,
	"rationale" text,
	"evidence_chips" jsonb,
	"kind" "entry_kind" DEFAULT 'fit' NOT NULL,
	"status" "entry_status" DEFAULT 'none' NOT NULL,
	"pass_reason" text,
	"reveal_consent" "reveal_consent" DEFAULT 'n/a' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "shortlist_status" DEFAULT 'assembling' NOT NULL,
	"pool_note" text,
	"sampled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"proficiency" integer DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"track" text,
	"course_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sponsor_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "sponsor_member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsor_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"tier" "sponsor_tier" DEFAULT 'premier' NOT NULL,
	"contract_start" timestamp with time zone,
	"contract_end" timestamp with time zone,
	"role_slots" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"andrew_id" text,
	"program" text,
	"grad_date" timestamp with time zone,
	"kind" "student_kind" DEFAULT 'undergrad' NOT NULL,
	"visibility" "visibility" DEFAULT 'searchable' NOT NULL,
	"startup_open" boolean DEFAULT false NOT NULL,
	"work_auth" jsonb,
	"locations" text[],
	"comp_expectation" jsonb,
	"last_verified_at" timestamp with time zone,
	"freshness_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_andrew_id_unique" UNIQUE("andrew_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_skill_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."skill_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_reports" ADD CONSTRAINT "coaching_reports_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_stories" ADD CONSTRAINT "experience_stories_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_sponsor_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sponsor_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_entry_id_shortlist_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."shortlist_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_moments" ADD CONSTRAINT "screen_moments_screen_id_screens_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_shortlist_id_shortlists_id_fk" FOREIGN KEY ("shortlist_id") REFERENCES "public"."shortlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_entries" ADD CONSTRAINT "shortlist_entries_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_claims" ADD CONSTRAINT "skill_claims_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_claims" ADD CONSTRAINT "skill_claims_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_members" ADD CONSTRAINT "sponsor_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_members" ADD CONSTRAINT "sponsor_members_org_id_sponsor_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."sponsor_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_agent_created_at_idx" ON "agent_runs" USING btree ("agent","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consents_student_id_idx" ON "consents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "dossiers_screen_id_idx" ON "dossiers" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "evidence_student_id_idx" ON "evidence" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "exceptions_status_idx" ON "exceptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "experience_stories_student_id_idx" ON "experience_stories" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "ledger_events_student_id_created_at_idx" ON "ledger_events" USING btree ("student_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "screen_moments_screen_id_idx" ON "screen_moments" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "screens_student_id_idx" ON "screens" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "shortlist_entries_shortlist_id_rank_idx" ON "shortlist_entries" USING btree ("shortlist_id","rank");--> statement-breakpoint
CREATE INDEX "shortlist_entries_student_id_idx" ON "shortlist_entries" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "shortlists_job_id_idx" ON "shortlists" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "skill_claims_student_id_idx" ON "skill_claims" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "sponsor_members_org_id_idx" ON "sponsor_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "students_user_id_idx" ON "students" USING btree ("user_id");