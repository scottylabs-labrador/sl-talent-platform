// Drizzle relations for the query API.
//
// DELIBERATE OMISSION: `screens` has NO `coachingReport` relation. Coaching
// reports are student-only. If `screens.coachingReport` existed, a sponsor
// query traversing job -> shortlist -> entry -> student -> screens could pull
// `with: { coachingReport }` and leak it. The relation is one-directional:
// you may go coachingReports -> screen (student context), never the reverse.

import { relations } from 'drizzle-orm';
import {
  users,
  students,
  sponsorOrgs,
  sponsorMembers,
  skills,
  skillClaims,
  evidence,
  claimEvidence,
  experienceStories,
  screens,
  screenMoments,
  dossiers,
  coachingReports,
  jobs,
  shortlists,
  shortlistEntries,
  outcomes,
  ledgerEvents,
  consents,
} from './schema.js';

export const usersRelations = relations(users, ({ one, many }) => ({
  student: one(students, {
    fields: [users.id],
    references: [students.userId],
  }),
  sponsorMemberships: many(sponsorMembers),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  user: one(users, { fields: [students.userId], references: [users.id] }),
  skillClaims: many(skillClaims),
  evidence: many(evidence),
  stories: many(experienceStories),
  screens: many(screens),
  shortlistEntries: many(shortlistEntries),
  ledgerEvents: many(ledgerEvents),
  consents: many(consents),
}));

export const sponsorOrgsRelations = relations(sponsorOrgs, ({ many }) => ({
  members: many(sponsorMembers),
  jobs: many(jobs),
}));

export const sponsorMembersRelations = relations(sponsorMembers, ({ one }) => ({
  user: one(users, { fields: [sponsorMembers.userId], references: [users.id] }),
  org: one(sponsorOrgs, {
    fields: [sponsorMembers.orgId],
    references: [sponsorOrgs.id],
  }),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  claims: many(skillClaims),
}));

export const skillClaimsRelations = relations(skillClaims, ({ one, many }) => ({
  student: one(students, {
    fields: [skillClaims.studentId],
    references: [students.id],
  }),
  skill: one(skills, {
    fields: [skillClaims.skillId],
    references: [skills.id],
  }),
  edges: many(claimEvidence),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
  student: one(students, {
    fields: [evidence.studentId],
    references: [students.id],
  }),
  edges: many(claimEvidence),
}));

export const claimEvidenceRelations = relations(claimEvidence, ({ one }) => ({
  claim: one(skillClaims, {
    fields: [claimEvidence.claimId],
    references: [skillClaims.id],
  }),
  evidence: one(evidence, {
    fields: [claimEvidence.evidenceId],
    references: [evidence.id],
  }),
}));

export const experienceStoriesRelations = relations(
  experienceStories,
  ({ one }) => ({
    student: one(students, {
      fields: [experienceStories.studentId],
      references: [students.id],
    }),
  }),
);

export const screensRelations = relations(screens, ({ one, many }) => ({
  student: one(students, {
    fields: [screens.studentId],
    references: [students.id],
  }),
  moments: many(screenMoments),
  dossier: one(dossiers, {
    fields: [screens.id],
    references: [dossiers.screenId],
  }),
  // NOTE: intentionally NO `coachingReport` relation here. See file header.
}));

export const screenMomentsRelations = relations(screenMoments, ({ one }) => ({
  screen: one(screens, {
    fields: [screenMoments.screenId],
    references: [screens.id],
  }),
}));

export const dossiersRelations = relations(dossiers, ({ one }) => ({
  screen: one(screens, {
    fields: [dossiers.screenId],
    references: [screens.id],
  }),
}));

// One-directional only: coachingReports -> screen. There is deliberately no
// inverse relation on screens (see file header).
export const coachingReportsRelations = relations(
  coachingReports,
  ({ one }) => ({
    screen: one(screens, {
      fields: [coachingReports.screenId],
      references: [screens.id],
    }),
  }),
);

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  org: one(sponsorOrgs, {
    fields: [jobs.orgId],
    references: [sponsorOrgs.id],
  }),
  shortlists: many(shortlists),
}));

export const shortlistsRelations = relations(shortlists, ({ one, many }) => ({
  job: one(jobs, { fields: [shortlists.jobId], references: [jobs.id] }),
  entries: many(shortlistEntries),
}));

export const shortlistEntriesRelations = relations(
  shortlistEntries,
  ({ one, many }) => ({
    shortlist: one(shortlists, {
      fields: [shortlistEntries.shortlistId],
      references: [shortlists.id],
    }),
    student: one(students, {
      fields: [shortlistEntries.studentId],
      references: [students.id],
    }),
    outcomes: many(outcomes),
  }),
);

export const outcomesRelations = relations(outcomes, ({ one }) => ({
  entry: one(shortlistEntries, {
    fields: [outcomes.entryId],
    references: [shortlistEntries.id],
  }),
  loggedByUser: one(users, {
    fields: [outcomes.loggedBy],
    references: [users.id],
  }),
}));

export const ledgerEventsRelations = relations(ledgerEvents, ({ one }) => ({
  student: one(students, {
    fields: [ledgerEvents.studentId],
    references: [students.id],
  }),
}));

export const consentsRelations = relations(consents, ({ one }) => ({
  student: one(students, {
    fields: [consents.studentId],
    references: [students.id],
  }),
}));
