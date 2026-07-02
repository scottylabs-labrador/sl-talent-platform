# Student App — implementation spec

Source prototype: `design_files/Student App.dc.html`. This is the single source of truth for
engineers recreating the student surface in Next.js (App Router) + React + TypeScript. The
prototype simulates all data and timers client-side with one `DCLogic` component; production
wiring is in ARCHITECTURE.md. Fidelity target is pixel-perfect.

Global frame notes:
- The iPhone bezel (`ios-frame.jsx`, imported as `IOSDevice`) is presentation only. Do NOT ship
  it. What matters: the phone **logical content width is 390px** (the import is 402px including
  bezel; hint-size `402px,874px`). Content columns pad `64px` at top (status-bar/notch safe area)
  and the tab bar reserves `26px` bottom (home-indicator safe area).
- Fonts (all three required, never system-ui): **Satoshi** 400/500/700/900 (display titles),
  **Inter** 400/500/600/700 (all UI), **JetBrains Mono** 400/500/600 (course codes, timestamps,
  scores, ids). Body: `font-family: Inter, ui-sans-serif, system-ui, sans-serif; color:#1e1e1e`.
- Page canvas `background:#f0f4f8`. Phone canvas `#f5f7fa`.
- Two global keyframes:
  - `@keyframes slpulse { 0%,100% { transform:scaleY(.35); } 50% { transform:scaleY(1); } }`
  - `@keyframes slfade { from { transform:translateY(7px); } to { transform:none; } }`
    NOTE: `slfade` animates **transform only, no opacity**. The README calls it "fade+rise 7px"
    but the actual keyframe is a 7px rise with no opacity ramp. Match the source (transform only).
- Standard content-enter animation on every tab/overlay root:
  `animation: slfade 240ms cubic-bezier(.2,0,0,1)` (overlays use `220ms`, sponsor panel `260ms`,
  toast `200ms`).

---

## Screen inventory

The app is one phone viewport with tab-based navigation plus three full-screen call overlays,
and (on Living Profile) an adjacent 640px desktop "view as sponsor" panel that renders beside
the phone. Client state keys that select a screen: `tab` (`home|profile|interviews|opps|settings`),
`call` (`null|pre|live|post`), `viewSponsor` (bool). A tab is only shown when `call` is null.

1. **Home** — `tab==='home' && !call`. Greeting header, PrimaryActionCard (or published-state
   confirmation card when `approved`), StrengthMeter, Live match card, Ledger preview (4 rows).
2. **Living Profile** — `tab==='profile' && !call`. Identity card, Talent Graph, Experience
   stories, Screen Dossier card. A "View as sponsor" pill toggles `viewSponsor`.
   2a. **View-as-sponsor desktop panel** — `viewSponsor===true`. A 640px panel appears to the
   right of the phone (page container is a horizontally-scrolling flex row, gap 36px). Shows a
   browser-chrome bar, license banner, and the sponsor render of the same profile.
3. **Interviews** — `tab==='interviews' && !call`. Talent Rep screen status card (two variants by
   `approved`), Coaching Report entry card, Semester refresher dashed card.
4. **Matches** — `tab==='opps' && !call`. Role card + AsyncQuestionCard with a record flow
   (idle → recording → done → sent).
5. **Settings ("You and your data")** — `tab==='settings' && !call`. Three visibility radio
   cards, full Data Ledger (6 rows), Export/Delete action row.
6. **CallRoom / Consent** — `call==='pre'`. Full-screen white overlay: agenda, "recording plainly"
   panel, two consent checkboxes, Start button (disabled until both), text-mode escape link.
7. **CallRoom / Live** — `call==='live'`. Full-screen `#070c11` overlay: REC pill + elapsed timer,
   180px progress arc with animated voice bars, caption stream (last 3 turns), Pause + End call.
8. **CallRoom / Post-call review** — `call==='post'`. Full-screen `#f5f7fa` overlay: Coaching
   Report card + Screen Dossier draft card (competency rows, 3 audio moments with visibility
   switches, Approve and publish).

Persistent chrome: bottom **tab bar** (5 tabs), page-top **jump-chip bar** (deep links, prototype
only), and a bottom-center **toast**.

### Navigation map (every transition)

- **Tab bar** (5 tabs): each sets `{ tab: <id>, call: null }`. Tabs: Home, Profile, Interviews,
  Matches, You.
- **Jump chips** (top bar, 8 chips — prototype-only deep links; do not ship in production, but
  they enumerate every reachable state):
  1. `Home` → `{tab:'home', call:null}`; active when `tab==='home' && !call`.
  2. `Profile` → `{tab:'profile', call:null, viewSponsor:false}`; active when `tab==='profile' && !call && !viewSponsor`.
  3. `Sponsor view` → `{tab:'profile', call:null, viewSponsor:true}`; active when `viewSponsor`.
  4. `Call: consent` → `{call:'pre', tab:'interviews', viewSponsor:false}`; active when `call==='pre'`.
  5. `Call: live` → `{call:'live', tab:'interviews', callT:0, paused:false, viewSponsor:false}`; active when `call==='live'`.
  6. `Call: review` → `{call:'post', tab:'interviews', viewSponsor:false}`; active when `call==='post'`.
  7. `Matches` → `{tab:'opps', call:null}`; active when `tab==='opps' && !call`.
  8. `Settings` → `{tab:'settings', call:null}`; active when `tab==='settings' && !call`.
- **Home → Start now / Book a slot**: `Start now` → `startPre` = `{call:'pre', tab:'interviews', consentA:false, consentB:false}`. `Book a slot` has no handler (dead in prototype).
- **Home → Answer Scogle's follow-up question** → `{tab:'opps'}`.
- **Home → "Do this next" box** → `{tab:'profile'}`. **Home → Full ledger** → `{tab:'settings'}`.
- **Profile → View as sponsor** → toggles `viewSponsor`, forces `{tab:'profile', call:null}`.
- **Profile → Screen Dossier card action** (`dossAction`, label varies): if `approved` →
  `{tab:'interviews'}`; else if `call==='post'` → `{call:'post'}`; else → `{call:'pre', tab:'interviews', consentA:false, consentB:false}`.
- **Interviews → Start / Retake** (both) → `startPre`. **Open report + dossier review** → `{call:'post'}`.
- **Consent → close (X)** → `{call:null}`. **Start the call** → `beginCall`: only if `consentA && consentB`, sets `{call:'live', callT:0, paused:false}`.
- **Live → Pause/Resume** → toggles `paused`. **End call** → `{call:'post'}`.
- **Post → close (X)** → `{call:null}`. **Approve and publish to sponsors** → `approveDossier`:
  `{approved:true, call:null, tab:'profile'}` + toast. **Strike a moment entirely** → toast only.
- **Matches → Tap to record** → `{recState:'rec', recT:0}`. **Done** → `sendRec`: `{recState:'sent'}` + toast.
- **Settings → visibility card** → sets `visibility` + toast. Export/Delete buttons have no handler.

---

## Component tree

Proposed React breakdown (names in **bold** match the handoff README where a name exists):

```
<StudentApp>                         // owns all client state (see State machine)
├─ <JumpChipBar>                     // prototype-only deep links (feature-flag off in prod)
├─ <PhoneFrame logicalWidth=390>     // replaces IOSDevice bezel; safe-area padding only
│  ├─ <ScrollArea>
│  │  ├─ <HomeScreen>                // tab==='home'
│  │  │  ├─ <GreetingHeader>
│  │  │  ├─ <PrimaryActionCard>      // when !approved  (tartan band)
│  │  │  ├─ <PublishedConfirmCard>   // when approved
│  │  │  ├─ <StrengthMeter>
│  │  │  ├─ <LiveMatchCard>          // role + 5-step timeline
│  │  │  └─ <LedgerPreview rows=4>
│  │  ├─ <LivingProfileScreen>       // tab==='profile'
│  │  │  ├─ <ProfileTitleRow>        // "View as sponsor" toggle
│  │  │  ├─ <IdentityCard>
│  │  │  ├─ <TalentGraph>            // skill chips + elbow + evidence cards (option 1h)
│  │  │  ├─ <ExperienceStories>      // Setup / Your part / Outcome grid
│  │  │  └─ <ScreenDossierCard>      // tartan band, status tag, one pill
│  │  ├─ <InterviewsScreen>          // tab==='interviews'
│  │  │  ├─ <TalentRepStatusCard>
│  │  │  ├─ <CoachingReportEntryCard>
│  │  │  └─ <SemesterRefresherCard>
│  │  ├─ <MatchesScreen>             // tab==='opps'
│  │  │  ├─ <RoleCard>               // company glyph, comp, timeline
│  │  │  └─ <AsyncQuestionCard>      // record flow
│  │  └─ <SettingsScreen>            // tab==='settings'
│  │     ├─ <VisibilityRadioCard> x3
│  │     ├─ <DataLedger rows=6>
│  │     └─ <DataActionsRow>         // Export everything / Delete account
│  ├─ <TabBar>                       // 5 tabs, frosted
│  ├─ <CallRoomConsent>             // call==='pre'   (overlay)
│  ├─ <CallRoomLive>                // call==='live'  (overlay)
│  └─ <CallRoomPostReview>          // call==='post'  (overlay)
│     ├─ <CoachingReportCard>
│     └─ <ScreenDossierDraftCard>
│        ├─ <CompetencyRow> x4       // 5-dot scale
│        └─ <AudioMomentRow> x3      // play btn + progress + visibility switch
├─ <SponsorPanel>                    // viewSponsor===true (640px, beside phone)
│  ├─ <BrowserChromeBar>
│  ├─ <LicenseBanner>
│  ├─ <SponsorIdentityCard>
│  ├─ <SponsorSkillsCard>
│  ├─ <SponsorDossierCard>           // competency + visible/ghost moment rows
│  └─ <NeverInViewFootnote>
└─ <Toast>
```

Shared leaf components: `<TartanBand>`, `<CompetencyRow>`, `<StatusTag>`, `<PillButton>`,
`<VoiceBars>`, `<StepTimeline>`, `<EvidenceCard>`, `<VisibilitySwitch>`.

---

## Exact styles per component

Colors are quoted hex/rgba from source. All buttons/pills use `border-radius:100px` (no exception).
Cards radius `12px`; evidence/inner cards `8px` or `10px`; tags `4px`. Resting shadow
`0 1px 2px rgba(30,30,30,.06)`; PrimaryActionCard uses raised `0 2px 8px rgba(30,30,30,.08)`.

### Page chrome (do not ship jump bar; keep tokens for reference)
- Top bar: `height:56px; background:#edf1f6; border-bottom:1px solid #d9e1e7; display:flex;
  align-items:center; gap:18px; padding:0 24px; position:sticky; top:0; z-index:40`.
  - Hub link: flex, gap 8px, `color:#4a5662; font-size:13px; font-weight:600`, arrow-left svg 14px.
  - Divider: `width:1px; height:20px; background:#c7d2dc`.
  - Title "Student app": `font-family:Satoshi; font-weight:700; font-size:15px; letter-spacing:-0.02em`.
  - Jump chips: `height:30px; padding:0 13px; border-radius:100px; font:600 12px Inter`.
    Active: `background:#1e1e1e; color:#fff; border:1px solid #1e1e1e`.
    Inactive: `background:#fff; color:#4a5662; border:1px solid #c7d2dc`.
- Main container: `flex:1; display:flex; align-items:flex-start; justify-content:safe center;
  gap:36px; padding:44px 32px 64px; overflow-x:auto`.

### Tab bar
`position:absolute; left:0; right:0; bottom:0; background:rgba(255,255,255,.92);
backdrop-filter:blur(12px); border-top:1px solid #e9ebf8; display:flex; padding:8px 6px 26px;
z-index:30`. Each tab: `flex:1; flex-direction:column; align-items:center; gap:3px; padding:6px 0`.
Icon `<svg width=22 height=22 stroke-width=1.9>`. Label `font-size:10px`. Active color `#0e96d1`,
weight 600; inactive color `#5f6f7f`, weight 500. Tab order + labels: Home, Profile, Interviews,
Matches, **You** (id `settings`).

### HomeScreen
- Root: `padding:64px 20px 24px; flex-direction:column; gap:16px`.
- GreetingHeader: greeting "Hey, June" `Satoshi 700 24px, letter-spacing:-0.02em`; subtitle
  "ScottyLabs Talent · profile live" `12.5px #5f6f7f`. Avatar: `40px circle; background:#063f58;
  color:#fff; font:600 14px Inter` reading "JP".
- **PrimaryActionCard** (only when `!approved`): `background:#fff; border-radius:12px;
  overflow:hidden; box-shadow:0 2px 8px rgba(30,30,30,.08)`.
  - Tartan band (verbatim recipe): `height:5px; background-color:#063f58;
    background-image:repeating-linear-gradient(90deg, rgba(215,36,68,.6) 0 5px, transparent 5px 26px,
    rgba(255,255,255,.18) 26px 28px, transparent 28px 52px),
    repeating-linear-gradient(0deg, rgba(14,150,209,.5) 0 2px, transparent 2px 7px)`.
  - Body: `padding:18px 18px 20px; gap:10px`. Eyebrow `11px/600 uppercase, letter-spacing:.07em,
    color:#0a6b94`. Title `Satoshi 700 19px, letter-spacing:-0.015em, line-height:1.25`. Body
    `13px, line-height:1.55, color:#4a5662`. Buttons row `gap:8px; margin-top:4px`:
    - Primary "Start now": `height:44px; padding:0 22px; border-radius:100px; border:none;
      background:#1e1e1e; color:#fff; font:600 14px Inter`; hover `background:#383838`.
    - Secondary "Book a slot": `height:44px; padding:0 18px; border:1px solid #c7d2dc;
      background:#fff; color:#1e1e1e; font:600 14px Inter`; hover `border-color:#869db3`.
- **PublishedConfirmCard** (only when `approved`): `background:#fff; border-radius:12px;
  padding:18px; flex-row; gap:12px; box-shadow:0 1px 2px rgba(30,30,30,.06)`. Icon chip
  `34px circle; background:#e7f5fa` with check svg (16px, `stroke:#0e96d1; stroke-width:2.2`).
  Title "Your Screen Dossier is live" `14px/600`; sub "Visible to 10 Premier sponsors under
  license" `12.5px #5f6f7f`.
- **StrengthMeter**: card `padding:18px; gap:12px; shadow resting`. Label row: "Profile strength"
  `13px/600` + value (JetBrains Mono `14px/600 #0a6b94`, renders the raw number e.g. `82`, no `%`).
  Track: `height:6px; border-radius:100px; background:#e9ebf8; overflow:hidden`; fill
  `background:linear-gradient(90deg,#0e96d1,#6940c9); width:{strengthPct}` (e.g. `82%`).
  "Do this next" box: `padding:10px 12px; border-radius:8px; border:1px dashed #aebdcc;
  background:#f8fafc`; hover `border-color:#0e96d1`. Plus svg 15px `stroke:#0a6b94`. Text
  `12.5px, line-height:1.45, color:#4a5662` with bold "Do this next:" (`#1e1e1e`) and bold "+4"
  (`#0a6b94`).
- **LiveMatchCard**: card `padding:18px; gap:10px`. Header "Live match" `13px/600` + status tag
  "Shortlisted" (`11px/600; color:#0d4b17; background:#dcefe0; border-radius:4px; padding:3px 8px`).
  Title "SWE Intern, Infrastructure · Scogle, Inc" `14.5px/600, line-height:1.3`. Timeline (see
  StepTimeline below). Labels row `10.5px #5f6f7f`, space-between: Matched / Shortlisted / Intro /
  Interview / Outcome. Button "Answer Scogle's follow-up question": `height:40px; border-radius:100px;
  border:1px solid #c7d2dc; background:#fff; font:600 13px Inter; color:#1e1e1e`; hover `border-color:#869db3`.
- **StepTimeline** (used on Home and Matches): flex row, each step `display:flex; align-items:center;
  flex:{grow}` (grow 1 except last = 0). Dot `10px circle; border:2px solid {ring}`. Connector bar
  (all but last) `height:2px; flex:1`. Done step: `background:#0e96d1; ring:#0e96d1`. Pending:
  `background:#fff; ring:#c7d2dc`. Bar color: `#0e96d1` if the NEXT step is done, else `#e0e6ee`.
  Seed: steps 1–2 done, 3–5 pending → dots [blue, blue, hollow, hollow, hollow]; bars
  [blue, gray, gray, gray].
- **LedgerPreview**: card `padding:18px; gap:2px`. Header "Your data, at work" `13px/600` +
  "Full ledger" text button (`#0e96d1 12px/600`). Rows (first 4 of ledger): each
  `padding:9px 0; border-top:1px solid #e9ebf8; gap:10px`. Chip `26px square; border-radius:6px;
  font:600 10px JetBrains Mono` (bg/fg per entry). Text `12.5px, line-height:1.4, #1e1e1e`;
  timestamp `11px #869db3`.
- Bottom spacer `height:76px` (clears tab bar).

### LivingProfileScreen
- Root `padding:64px 20px 24px; gap:14px`.
- Title row: "Living Profile" `Satoshi 700 24px -0.02em`. **View-as-sponsor toggle**:
  `height:34px; padding:0 12px; border-radius:100px; gap:8px; font:600 12px Inter`; eye svg 14px.
  Inactive: `background:#fff; color:#1e1e1e; border:1px solid #c7d2dc`. Active (`viewSponsor`):
  `background:#063f58; color:#fff; border:1px solid #063f58`.
- **IdentityCard**: card `padding:18px; gap:12px`. Avatar `52px; border-radius:14px;
  background:#063f58; color:#fff; font:600 18px Inter` = "JP". Name "June Park" `Satoshi 700 19px
  -0.015em`. Meta "SCS · BS Computer Science · May 2027" `12.5px #4a5662`. Mono caption
  "junepark · verified via CMU SSO" `JetBrains Mono 11px #869db3`. Logistics chips (5): each
  `font-size:11.5px; font-weight:500; color:#4a5662; background:#f0f4f8; border-radius:4px;
  padding:5px 9px`.
- **TalentGraph**: card `padding:18px; gap:12px`. Header "Talent Graph" `13px/600` + hint
  "tap a skill to light its thread" `11px #869db3`. Body is a 3-column flex row:
  - Left skill column: `width:120px; flex-direction:column; gap:7px`. Each chip is a button:
    `padding:8px 11px; border-radius:12px; border:1.5px {solid|dashed} {bd}; font:600 11px Inter;
    text-align:left; line-height:1.35; flex-direction:column; gap:2px`. States:
    - Verified (`v:true`), not selected: `background:#e7f5fa; color:#0a6b94; border:1.5px solid #90cfea`,
      caption "{n} wired" (`JetBrains Mono 9px; opacity:.7; weight:500`).
    - Unverified (`v:false`), not selected: `background:#fff; color:#5f6f7f; border:1.5px dashed #aebdcc`,
      caption "no proof yet" (`9px; opacity:.7; weight:500`).
    - Selected (`expandedSkill===id`, ANY skill): `background:#063f58; color:#fff; border:1.5px solid #063f58`.
  - **Elbow connector** (verbatim): `width:16px; flex:none; border-left:2px solid #90cfea;
    border-bottom:2px solid #90cfea; border-radius:0 0 0 10px; height:170px; margin-top:16px`.
  - Right evidence column: `flex:1; min-width:0; flex-direction:column; gap:7px; margin-left:-6px;
    padding-top:4px`. If a skill is expanded (`hasExp`): expanded-skill name header
    `11px/600 #0a6b94; padding-left:2px`, then one **EvidenceCard** per evidence item. If none
    expanded (`noExp`, i.e. `expandedSkill===null`): dashed empty box `border:1px dashed #c7d2dc;
    border-radius:8px; padding:12px; margin-top:14px`, text "Tap a skill on the left to trace its
    evidence thread." `11px, line-height:1.5, #869db3`.
  - **EvidenceCard** (per provenance): `border:1px {cardStyle} {cardBd}; border-left:3px solid {edge};
    border-radius:8px; padding:8px 10px; gap:3px; opacity:{op}; background:#fff`. Label
    `11px/600, line-height:1.35, color:{fg}`. Caption `8.5px/600 uppercase, letter-spacing:.05em,
    color:{capFg}`. Provenance mapping (load-bearing):
    - Verified (non-audio): `edge:#0e96d1; capFg:#0a6b94; cardStyle:solid; cardBd:#e9ebf8; fg:#1e1e1e;
      op:1`; caption "Verified · {src}".
    - Verified audio (`src==='audio'`): `edge:#6940c9` (purple); `capFg:#4b2d8f`; caption "Verified · audio".
    - Pending (`prov==='Pending'`): `edge:#e8b13a` (amber); `capFg:#654a00`; caption "Pending · Verifier check".
    - Self-reported with a source (`prov==='Self-reported', src!=='missing'`): `edge:#c7d2dc;
      capFg:#5f6f7f; cardStyle:solid; cardBd:#e9ebf8`; caption "Self-reported · {src}".
    - Missing (`src==='missing'`): `edge:#c7d2dc; capFg:#869db3; cardStyle:dashed; cardBd:#c7d2dc;
      fg:#5f6f7f; opacity:.75`; caption "Missing · attach to verify".
  - Footnote below the graph body: "Solid chips are wired to proof; dashed claims dangle until
    evidence attaches. Sponsors see the same wiring." `11px, line-height:1.5, #869db3`.
- **ExperienceStories**: section label "Experience stories" `13px/600; padding:0 2px`. Each story
  card: `padding:16px 18px; gap:10px; shadow resting`. Header: title `14px/600, line-height:1.3` +
  when `11px #869db3` (flex:none). Grid rows (Setup / Your part / Outcome):
  `display:grid; grid-template-columns:64px 1fr; gap:8px`. Label `11px/600 uppercase,
  letter-spacing:.05em, color:#869db3, padding-top:1px`. Values `12.5px, line-height:1.5`:
  Setup `#4a5662`, Your part `#1e1e1e`, Outcome `#1e1e1e` normally. **Missing outcome** renders
  `color:#991a30; font-style:italic` (never blank).
- **ScreenDossierCard**: card `overflow:hidden` with 5px tartan band (same recipe). Body
  `padding:16px 18px 18px; gap:8px`. Header "Screen Dossier" `13px/600` + status tag (`11px/600;
  border-radius:4px; padding:3px 8px`, colors below). Note text `12.5px, line-height:1.55, #4a5662`.
  One pill action `height:40px; border-radius:100px; border:1px solid #c7d2dc; background:#fff;
  font:600 13px Inter; color:#1e1e1e; margin-top:2px`; hover `border-color:#869db3`.
  Status/note/action by state:
  - `approved`: tag "Live" (`#0d4b17` on `#dcefe0`); note "3 audio moments visible to sponsors,
    stream only. You control each moment, and every play is logged in your ledger."; action
    "Manage moment visibility" → `{tab:'interviews'}`.
  - `call==='post'`: tag "Awaiting your approval" (`#654a00` on `#fdf6e3`); note "Complete your
    Talent Rep screen and approve the draft. Nothing sponsor-visible ships without your sign-off.";
    action "Review the draft" → `{call:'post'}`.
  - default: tag "Pending" (`#654a00` on `#fdf6e3`); same note as post; action "Start the screen"
    → `{call:'pre', tab:'interviews', consentA:false, consentB:false}`.
- Bottom spacer `76px`.

### InterviewsScreen
- Root `padding:64px 20px 24px; gap:14px`. Title "Interviews" `Satoshi 700 24px`.
- **TalentRepStatusCard** (variant by `approved`):
  - approved: card `padding:16px 18px; gap:10px`. Header "Talent Rep screen" `14px/600` + tag
    "Completed · Jul 1" (`10.5px/600 #0d4b17 on #dcefe0; radius 4; padding 3px 8px`). Body
    "Dossier live with 3 audio moments. Coaching report below is private to you, always."
    `12.5px, line-height:1.5, #4a5662`. Button "Retake (1 left this semester, invisible to
    sponsors)" `height:38px; radius 100; border:1px solid #c7d2dc; font:600 12.5px` → `startPre`.
  - not approved: "Talent Rep screen" `14px/600`; body "Not done yet. It is the one contribution
    that unlocks Premier shortlists, and you keep the coaching report either way." Button "Start
    the 30-minute screen" `height:44px; background:#1e1e1e; color:#fff; font:600 13.5px`; hover
    `#383838` → `startPre`.
- **CoachingReportEntryCard** (always): header "Coaching Report · Jul 1" `14px/600` + tag
  "Private to you" (`10.5px/600 #4b2d8f on #d1c4ee`). Body "Two strengths, two growth areas, two
  practice suggestions from the Coach. The Coach is on your side; the Recruiter is neutral."
  Button "Open report + dossier review" `height:38px; border:1px solid #c7d2dc; font:600 12.5px`;
  hover `border-color:#869db3` → `{call:'post'}`.
- **SemesterRefresherCard**: `border:1px dashed #aebdcc; border-radius:12px; padding:14px 16px;
  gap:5px`. Title "Semester refresher · opens Dec 8" `12.5px/600 #4a5662`. Body "A 10-minute
  voice check-in to log new coursework and your internship. Keeps your freshness date current in
  matching." `12px, line-height:1.5, #5f6f7f`.
- Bottom spacer `76px`.

### MatchesScreen
- Root `padding:64px 20px 24px; gap:14px`. Title "Matches" `Satoshi 700 24px`.
- **RoleCard**: card `padding:16px 18px; gap:11px`. Company glyph `32px; border-radius:8px;
  background:#063f58; color:#fff; font:700 13px Satoshi` = "S". Title "SWE Intern, Infrastructure"
  `14px/600`; sub "Scogle, Inc · Pittsburgh or Kirkland" `11.5px #5f6f7f`. Tag "Shortlisted"
  (`10.5px/600 #0d4b17 on #dcefe0`). Comp line (always shown) "$54/hr · Summer 2027 · CPT friendly
  · comp disclosed per platform policy" `12px #4a5662`. StepTimeline + labels (same as Home).
- **AsyncQuestionCard**: `background:#fff; border:1.5px solid #90cfea; border-radius:12px;
  padding:16px 18px; gap:10px; box-shadow:0 2px 8px rgba(14,150,209,.1)`. Eyebrow "Follow-up from
  the Recruiter" (`11px/600 uppercase, letter-spacing:.06em, #0a6b94`) + meta "2 min · voice"
  (`10.5px #869db3`). Question `13.5px, line-height:1.5, #1e1e1e`: `"RailTrace buffered bursty
  writes for one rail line. What breaks first if Scogle pointed 40,000 fleet units at it, and what
  would you change?"`. Then one of four record states:
  - `recState==='idle'`: button "Tap to record your reply" `height:46px; background:#1e1e1e;
    color:#fff; font:600 13.5px; gap:8px`; hover `#383838`; mic svg 14px.
  - `recState==='rec'`: dark pill `background:#070c11; border-radius:100px; padding:8px 10px 8px 18px;
    gap:12px`. Red dot `8px circle #d72444`. Voice bars container `height:18px; gap:2px; flex:1`,
    bars: `width:2.5px; height:{rb.h}px; max-height:18px; border-radius:2px; background:#5eb9e0;
    transform-origin:bottom; animation:slpulse 700ms ease-in-out infinite; animation-delay:{rb.d}ms`.
    Timer `JetBrains Mono 12px #fff` = `recT` (`0.0s` format). "Done" button `height:34px;
    padding:0 16px; background:#0e96d1; color:#fff; font:600 12.5px` → `sendRec`.
  - `recState==='done'`: text "Recording captured." `12px #4a5662`. (See ambiguity note.)
  - `recState==='sent'`: green confirm row `background:#dcefe0; border-radius:10px; padding:11px 13px;
    gap:9px`, check svg 15px `stroke:#0d4b17; stroke-width:2.4`, text "Sent. It rides with your
    shortlist card, and you can hear it in your ledger." `12.5px/500 #0d4b17`.
- Bottom spacer `76px`.

### SettingsScreen
- Root `padding:64px 20px 24px; gap:14px`. Title "You and your data" `Satoshi 700 24px`.
- Visibility section: label "Visibility" `13px/600; padding:0 2px`. Three **VisibilityRadioCard**
  buttons: `display:flex; gap:11px; align-items:flex-start; text-align:left; border-radius:12px;
  padding:13px 14px; border:1.5px solid {bd}`. Selected: `background:#e7f5fa; border-color:#0e96d1`;
  unselected: `background:#fff; border-color:#c7d2dc`. Radio dot: `18px circle; border:1.75px solid
  {bd}; background:#fff`; when selected an inner `9px circle #0e96d1`. Label `13.5px/600 #1e1e1e`;
  desc `12px, line-height:1.5, #4a5662`.
- **DataLedger** card: `padding:16px 18px; gap:2px`. Header "Data Ledger" `13px/600` + "every
  access, logged" `11px #869db3`. Six rows: `padding:9px 0; border-top:1px solid #e9ebf8; gap:10px;
  align-items:flex-start`. Kind tag: `font-size:10px; font-weight:600; uppercase;
  letter-spacing:.04em; border-radius:4px; padding:3px 7px; min-width:34px; text-align:center`
  (bg/fg per entry). Text `12.5px, line-height:1.45, #1e1e1e`; when `11px #869db3`.
- **DataActionsRow**: `gap:8px`. "Export everything" `flex:1; height:42px; border:1px solid #c7d2dc;
  background:#fff; font:600 12.5px; color:#1e1e1e`; hover `border-color:#869db3`. "Delete account,
  for real" `flex:1; height:42px; border:1px solid #f3bbc5; background:#fff; color:#c4213e`; hover
  `background:#fdf2f4`. Neither has a click handler in the prototype.
- Bottom spacer `76px`.

### CallRoomConsent (`call==='pre'`)
- Overlay: `position:absolute; inset:0; z-index:50; background:#fff; flex-column;
  animation:slfade 220ms cubic-bezier(.2,0,0,1)`.
- Header `padding:64px 20px 12px`, space-between: "Before we start" `Satoshi 700 21px -0.02em`;
  close button `34px circle; border:1px solid #c7d2dc; background:#fff`, X svg 14px `stroke:#4a5662`
  → `{call:null}`.
- Body `flex:1; overflow:auto; padding:4px 20px 20px; gap:14px`:
  - Agenda box `border:1px solid #e9ebf8; border-radius:12px; padding:14px 16px; gap:8px`. Label
    "30 minutes, six parts" `11px/600 uppercase, letter-spacing:.07em, #869db3`. Six rows, each
    `align-items:baseline; gap:10px`: number (`JetBrains Mono 11px #0e96d1`), name (`13px #1e1e1e;
    flex:1`), time (`11.5px #869db3`).
  - "The recording, plainly" panel `background:#f8fafc; border:1px solid #e9ebf8; border-radius:12px;
    padding:14px 16px; gap:9px`. Label `11px/600 uppercase #869db3`. Two paragraphs `12.5px,
    line-height:1.55, #4a5662` (copy in Copy section).
  - Consent checkbox A + B (buttons): `border:1px solid {consentXBd}; border-radius:12px;
    padding:13px 14px; gap:11px; align-items:flex-start; background:#fff`. Border `#0e96d1` when
    checked else `#e9ebf8`. Box: `20px; border-radius:5px; border:1.75px solid {boxBd};
    background:{boxBg}`; checked → `border/bg:#0e96d1` with white check svg 11px `stroke-width:3.5`;
    unchecked → `border:#869db3; background:#fff`. Label text `12.5px, line-height:1.5, #1e1e1e`.
  - "Start the call" button `height:48px; border-radius:100px; border:none; color:#fff;
    font:600 15px; margin-top:2px`; `background:#1e1e1e` when both checked else `#c7d2dc` (disabled
    look). Handler `beginCall` no-ops unless both checked.
  - Text-mode link "Prefer text? Take the written version instead" `height:40px; background:none;
    color:#5f6f7f; font:500 12.5px`; no handler (dead in prototype).

### CallRoomLive (`call==='live'`)
- Overlay: `inset:0; z-index:50; background:#070c11; flex-column; animation:slfade 220ms`.
  (The ios-frame `dark` prop is driven by `phoneDark = call==='live'`; presentation only.)
- Top row `padding:62px 20px 6px`, space-between:
  - REC pill: `display:flex; align-items:center; gap:7px; font-size:11px; font-weight:600;
    letter-spacing:.05em; color:#f3bbc5; border:1px solid rgba(215,36,68,.5); border-radius:100px;
    padding:6px 11px`, text "REC · consented", with `7px` red dot `#d72444`.
  - Timer: `JetBrains Mono 13px; color:rgba(255,255,255,.75)` = `{mmss} / 30:00`. `mmss` derives
    from `baseSec = 872 + floor(callT)` (starts at "14:32", counts up). NOTE the timer is offset
    872s from `callT`; captions use raw `callT` — a prototype artifact. In production drive both
    from the interview state machine.
- **Progress arc** (center block, `flex-direction:column; align-items:center; gap:2px; padding:8px 0 0`):
  - Container `position:relative; width:180px; height:180px`; `<svg width=180 height=180
    viewBox="0 0 180 180">` with 6 `<path>` segments, `fill:none; stroke-linecap:round`.
  - Geometry (verbatim): center `(90,90)`, radius `76`. For segment `i` (0..5):
    `a0 = (i*60 - 90 + 5)°`, `a1 = ((i+1)*60 - 90 - 5)°` (each segment spans 50°, with 10° gaps).
    Point `p(a) = (90 + 76·cos a, 90 + 76·sin a)`, coords `toFixed(1)`. Path =
    `M {p(a0)} A 76 76 0 0 1 {p(a1)}`. Computed paths:
    - Seg0: `M 96.6 14.3 A 76 76 0 0 1 152.3 46.4`
    - Seg1: `M 158.9 57.9 A 76 76 0 0 1 158.9 122.1`
    - Seg2: `M 152.3 133.6 A 76 76 0 0 1 96.6 165.7`
    - Seg3: `M 83.4 165.7 A 76 76 0 0 1 27.7 133.6`  (active)
    - Seg4: `M 21.1 122.1 A 76 76 0 0 1 21.1 57.9`
    - Seg5: `M 27.7 46.4 A 76 76 0 0 1 83.4 14.3`
  - Stroke/width by state: segments 0,1,2 (done) `stroke:#0e96d1; stroke-width:5`; segment 3
    (active) `stroke:#5eb9e0; stroke-width:7`; segments 4,5 (upcoming) `stroke:rgba(255,255,255,.14);
    stroke-width:5`.
  - Inner disc: `position:absolute; inset:22px; border-radius:50%; background:radial-gradient(circle
    at 50% 38%, rgba(14,150,209,.28), rgba(7,12,17,0) 70%)`. Contains:
    - **Voice bars**: container `display:flex; align-items:flex-end; gap:2.5px; height:26px`. 24
      bars: `width:3px; height:{b.h}px; border-radius:2px; background:#5eb9e0; transform-origin:bottom;
      animation:slpulse 900ms ease-in-out infinite; animation-delay:{b.d}ms;
      animation-play-state:{barPlay}`. `barPlay = paused ? 'paused' : 'running'`. Bar generator
      (24 items, index i): `d = (i*137) % 400` (ms), `h = 8 + ((i*53) % 20)` (px, range 8–27).
    - Section name `secName` = "Deep dive 2 of 2" `12px/600 #fff`.
    - Section sub `secSub` = "RailTrace, TartanHacks 2026" `10.5px; color:rgba(255,255,255,.55)`.
  - Below arc: "The Rep is listening" `10.5px uppercase; letter-spacing:.06em; color:rgba(255,255,255,.4)`.
- **Caption stream**: `flex:1; overflow:hidden; flex-direction:column; justify-content:flex-end;
  gap:10px; padding:12px 18px 14px`. Renders last up-to-3 turns (window
  `caps.slice(max(0,capIdx-2), capIdx+1)`, `capIdx = min(floor(callT/3.4), 8)`). Each turn:
  `flex-column; gap:3px; align-self:{align}; max-width:88%; opacity:{op};
  animation:slfade 260ms cubic-bezier(.2,0,0,1)`. Speaker label `10px/600 uppercase;
  letter-spacing:.06em; color:rgba(255,255,255,.45); padding:0 6px` ("Talent Rep" or "You").
  Bubble `13px, line-height:1.5, color:#fff; border-radius:14px; padding:9px 13px; background:{bg};
  border:1px solid {bd}`. Rep (left, `flex-start`): `bg:rgba(255,255,255,.08); bd:rgba(255,255,255,.14)`.
  You (right, `flex-end`): `bg:rgba(14,150,209,.22); bd:rgba(14,150,209,.45)`. The last (current)
  turn `opacity:1`; earlier turns `opacity:0.45`.
- Controls `padding:6px 20px 36px; gap:10px`: Pause/Resume button `flex:1; height:48px;
  border-radius:100px; border:1px solid rgba(255,255,255,.25); background:rgba(255,255,255,.06);
  color:#fff; font:600 14px` (label = `paused ? 'Resume' : 'Pause'`). End call `flex:1; height:48px;
  border:none; background:#d72444; color:#fff; font:600 14px`; hover `#c4213e` → `{call:'post'}`.

### CallRoomPostReview (`call==='post'`)
- Overlay: `inset:0; z-index:50; background:#f5f7fa; flex-column; animation:slfade 220ms`.
- Header `padding:64px 20px 10px; background:#f5f7fa`, space-between: left column "Two things
  arrived" `Satoshi 700 21px -0.02em` + "Call ended at 29:12 · transcript saved" `12px #5f6f7f`;
  close button (`34px circle`, X svg) → `{call:null}`.
- Body `flex:1; overflow:auto; padding:8px 20px 40px; gap:14px`:
  - **CoachingReportCard**: card `padding:16px 18px; gap:11px`. Header "Coaching Report" `14px/600`
    + tag "Private to you" (`10.5px/600 #4b2d8f on #d1c4ee`). Three groups, each `gap:5px`:
    group label `11px/600 uppercase; letter-spacing:.06em` — "What landed" `#0d4b17`, "What was
    vague" `#654a00`, "Practice next" `#0a6b94`; each with 2 lines `12.5px, line-height:1.55, #4a5662`.
  - **ScreenDossierDraftCard**: card `overflow:hidden` + 5px tartan band. Body `padding:16px 18px 18px;
    gap:12px`. Header "Screen Dossier, draft" `14px/600` + tag "Ships only if you approve"
    (`10.5px/600 #654a00 on #fdf6e3`).
    - **CompetencyRow** x4: `align-items:center; gap:10px`. Name `12.5px #1e1e1e; flex:1`. Five dots
      `8px circle; gap:3px`; filled `#0e96d1`, empty `#e0e6ee`. Link `JetBrains Mono 10px #0e96d1;
      width:86px; text-align:right`.
    - Audio moments block: `border-top:1px solid #e9ebf8; padding-top:11px; gap:9px`. Sub-label
      "Audio moments · you control each" `11px/600 uppercase #869db3`. Three **AudioMomentRow**:
      `border:1px solid #e9ebf8; border-radius:10px; padding:11px 12px; gap:8px; background:#f8fafc`.
      - Top line `align-items:center; gap:10px`: **play button** `34px circle; border:none;
        background:#063f58; color:#fff`; icon = pause (two rects) when playing, play (triangle)
        when not. Middle `flex:1; min-width:0; gap:2px`: tag `12px/600`, progress track `height:4px;
        border-radius:100px; background:#e0e6ee; overflow:hidden` with fill `height:100%;
        background:#0e96d1; width:{pct}; transition:width 90ms linear`. Position/duration
        `JetBrains Mono 10.5px #869db3` = "{posLabel} / {durLabel}". **VisibilitySwitch**
        `width:40px; height:23px; border-radius:100px; border:1px solid {swBd}; background:{swBg};
        position:relative`; knob `position:absolute; top:2px; left:{swLeft}; width:17px; height:17px;
        border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2); transition:left 180ms
        cubic-bezier(.2,0,0,1)`. On: `swBg:#0e96d1; swBd:#0e96d1; swLeft:20px`. Off: `swBg:#fff;
        swBd:#aebdcc; swLeft:2px`.
      - Quote line `12px, line-height:1.5, #4a5662; font-style:italic`, wrapped in quotes.
    - "Strike a moment entirely" text button `font:500 12px; color:#5f6f7f; text-align:left;
      text-decoration:underline; text-underline-offset:3px` → `strikeInfo` (toast only).
    - "Approve and publish to sponsors" button `height:46px; border-radius:100px; border:none;
      background:#1e1e1e; color:#fff; font:600 14px`; hover `#383838` → `approveDossier`.

### SponsorPanel (`viewSponsor===true`)
- Outer: `width:640px; flex:none; flex-column; border-radius:14px; overflow:hidden;
  box-shadow:0 8px 24px rgba(30,30,30,.14); border:1px solid #d9e1e7; animation:slfade 260ms`.
- **BrowserChromeBar**: `background:#1e1e1e; padding:10px 18px; gap:10px`. Three dots (`9px circle
  #4a5662`). URL `JetBrains Mono 12px #aebdcc` = "talent.scottylabs.org/pool/junepark · as Jordan
  @ Scogle".
- **LicenseBanner**: `background:#e7f5fa; border-bottom:1px solid #b4def1; padding:8px 18px; gap:8px`.
  Shield svg 13px `stroke:#0a6b94`. Text `11.5px #0a6b94` = "Premier license: internal recruiting
  use only, no resale, no model training. This view was just logged to June's ledger."
- Body `background:#f5f7fa; padding:20px 22px 24px; gap:14px`:
  - **SponsorIdentityCard**: card `padding:18px 20px; align-items:center; gap:14px`. Avatar 52px
    radius14 `#063f58` "JP". Name "June Park" `Satoshi 700 19px` + "SSO verified" tag
    (`10px/600 uppercase; letter-spacing:.04em; color:#0a6b94; background:#e7f5fa; border:1px solid
    #90cfea; border-radius:4px; padding:2px 6px`). Meta "SCS · BS Computer Science · May 2027 ·
    Pittsburgh or SF Bay · F-1, CPT eligible" `12.5px #4a5662`. Sub "Profile refreshed 3 days ago ·
    screen completed Jul 1" `11.5px #869db3`.
  - **SponsorSkillsCard**: card `padding:16px 20px; gap:10px`. Header "Skills, evidence-weighted"
    `12px/600 uppercase; letter-spacing:.06em; #869db3`. Skill pills (reuse the same `skills`
    array — so the currently-expanded skill also renders solid dark here): `height:30px;
    padding:0 12px; border-radius:100px; border:1.5px {solid|dashed} {bd}; font:600 12px;
    display:inline-flex; align-items:center; gap:6px`; verified pills append count (`JetBrains
    Mono 9.5px; opacity:.75`, e.g. "×3"). Same bg/fg/bd rules as the profile chips. Footnote
    "Hollow chips are the candidate's own claims. They rank lower until evidence attaches."
    `11px #869db3`.
  - **SponsorDossierCard**: card `overflow:hidden` + 5px tartan band. Body `padding:16px 20px 18px;
    gap:11px`. Header "Screen Dossier · Jul 1" `13px/600` + "audio is stream only, plays are logged"
    `10.5px #869db3`. Competency rows (4, same CompetencyRow). Then `border-top:1px solid #e9ebf8;
    padding-top:10px; gap:8px` with sponsor moment rows:
    - Visible moment (`momentsOn[mid]===true`): `border:1px solid #e9ebf8; border-radius:10px;
      padding:10px 12px; align-items:center; gap:10px; background:#f8fafc`. Play button `32px circle
      #063f58` (play/pause icon 11px). Middle `flex:1; gap:3px`: tag `12px/600`, progress `4px`
      track `#e0e6ee` fill `#0e96d1`, quote `11.5px, line-height:1.45, #4a5662; font-style:italic`.
      Duration `JetBrains Mono 10px #869db3`.
    - Hidden/ghost moment (`momentsOn[mid]===false`): `border:1px dashed #c7d2dc; border-radius:10px;
      padding:10px 12px; align-items:center; gap:10px; opacity:.65`. Eye-off svg 14px `stroke:#869db3`.
      Text `11.5px #869db3` = `You hid "{tag}". Sponsors do not see this row at all.`
  - **NeverInViewFootnote**: `border:1px dashed #aebdcc; border-radius:12px; padding:12px 16px;
    gap:9px; align-items:flex-start`. Lock svg 14px `stroke:#5f6f7f`. Text `11.5px, line-height:1.55,
    #5f6f7f` = "Never in this view: your coaching report, struck moments, grades, retake history,
    and anything you set to hidden. This panel is exactly what Jordan sees, nothing more."

### Toast
`position:fixed; bottom:28px; left:50%; transform:translateX(-50%); background:#1e1e1e; color:#fff;
border-radius:100px; padding:12px 22px; font-size:13px; font-weight:500;
box-shadow:0 8px 24px rgba(30,30,30,.25); z-index:99; animation:slfade 200ms cubic-bezier(.2,0,0,1)`.
One at a time. Auto-dismiss after **2600ms** (`setTimeout`). README says ~2.8s; the source value
is 2600ms — use 2600ms.

---

## Interactions & state machine

Single stateful component. Initial state:

```js
{
  tab: 'home', call: null, callT: 0, paused: false,
  viewSponsor: false, consentA: false, consentB: false,
  momentsOn: { m1: true, m2: true, m3: true, m4: true },   // m4 is unused (only 3 moments exist)
  approved: false, expandedSkill: 'sk1', playing: null, playT: 0,
  visibility: 'searchable', recState: 'idle', recT: 0, toast: null, dossierTab: 'screen'
}
```
`dossierTab` is initialized but never read in this file (carried from the sponsor spec). `strength`
is an external prop, default **82** (range 20–100, step 1).

### Global 100ms timer (`setInterval(…, 100)`, cleared on unmount)
On each tick:
1. If `call==='live' && !paused`: `callT += 0.1`.
2. If `playing` (a clip id is set): `playT += 0.1`; look up the clip; if `playT >= clip.dur` reset
   `{playing:null, playT:0}` (clip stops at its end). Otherwise store the new `playT`.
3. If `recState==='rec'`: `recT += 0.1`; if `recT >= 14` set `{recState:'done', recT:14}`.

### Derived values (recompute each render)
- `strength(display) = strength + (approved ? 6 : 0)` → 82 normally, **88** when approved.
  `strengthPct = display + '%'`.
- `mmss`: `baseSec = 872 + floor(callT)`; `mm:ss` zero-padded. Starts "14:32".
- Captions window: `capIdx = min(floor(callT / 3.4), 8)`; slice `[max(0,capIdx-2), capIdx+1]`
  (a rolling window of the last 3 turns). Current turn opacity 1, older 0.45.
- Arc sections + voice bars: see CallRoomLive geometry above (`barPlay` = paused/running).
- Clips → moments: `clip.on = playing===id`; `pct = on ? min(100, playT/dur*100)+'%' : '0%'`;
  `posLabel = on ? '0:0'+floor(playT) : '0:00'`; `durLabel = '0:0'+dur`. Each moment `mid='m'+(i+1)`;
  `visible = momentsOn[mid]`; switch styling from `visible`. `sponsorMoments` add `ghost = !visible`.

### Event handlers (exact effects)
- Tab go (x5): `{tab:<id>, call:null}`.
- Jump chips (x8): as listed in the navigation map.
- `startPre`: `{call:'pre', tab:'interviews', consentA:false, consentB:false}` (always resets consent).
- `flipA` / `flipB`: toggle `consentA` / `consentB`.
- `beginCall`: if `consentA && consentB` → `{call:'live', callT:0, paused:false}`; else no-op.
- `exitCall` (close X on consent + post): `{call:null}`.
- `flipPause`: toggle `paused` (also pauses the voice-bar animation via `animation-play-state`).
- `endCall`: `{call:'post'}`.
- `approveDossier`: `{approved:true, call:null, tab:'profile'}` then toast "Dossier published.
  Sponsors now see your approved version." — This is the big flip: Home swaps PrimaryActionCard →
  PublishedConfirmCard, StrengthMeter jumps 82→88, Interviews swaps to the "Completed" variant,
  and the Profile + Sponsor Screen Dossier status becomes "Live" with the published note. It is the
  only path to sponsor visibility.
- `strikeInfo`: toast "Struck moments never render for sponsors, and it is not held against you."
- `openPost`: `{call:'post'}`.
- `flipSponsor`: `{viewSponsor: !viewSponsor, tab:'profile', call:null}`.
- Skill `pick`: `{expandedSkill: expandedSkill===id ? null : id}` (tapping the open skill closes it,
  showing the empty-state prompt).
- Moment `toggle` (play button): `{playing: on ? null : id, playT:0}` (starts/stops that clip;
  starting a clip resets `playT` to 0; only one clip plays at a time).
- Moment `flip` (visibility switch): `{momentsOn:{...momentsOn, [mid]: !visible}}` — takes effect
  immediately in the sponsor render (visible row ⇄ ghost row).
- `startRec`: `{recState:'rec', recT:0}`.
- `sendRec` (Done): `{recState:'sent'}` + toast "Reply sent to the Recruiter. Scogle sees it with
  your shortlist card."
- Visibility `pick`: `{visibility:v}` + toast `"Visibility set to " + v + ". Effective now,
  including the MCP layer."` (v is the raw id: `searchable` / `match-only` / `paused`).
- `pop(msg)`: sets `toast`, clears prior timer, schedules clear after 2600ms.

### Animations / timers summary
- Content enter: `slfade` — tabs 240ms, call overlays 220ms, caption bubbles 260ms, sponsor panel
  260ms, toast 200ms; all `cubic-bezier(.2,0,0,1)`.
- Voice bars: `slpulse` scaleY .35↔1; live-call 900ms with per-bar `delay=(i*137)%400`ms and
  `animation-play-state` bound to pause; record-pill 700ms same delays.
- Clip progress + moment progress fill: `transition:width 90ms linear`; underlying value ticks at
  100ms.
- Visibility switch knob: `transition:left 180ms cubic-bezier(.2,0,0,1)`.
- Motion rules (handoff): 120–280ms, `cubic-bezier(.2,0,0,1)`; hover darkens, never scales/lifts.

### Conditional renders (summary)
- Tabs gated on `tab===… && !call`. Overlays gated on `call==='pre'|'live'|'post'`.
- Home: PrimaryActionCard when `!approved`; PublishedConfirmCard when `approved`.
- Profile skill evidence column: expanded skill's evidence when `expandedSkill` matches a skill,
  else empty-state prompt.
- Story outcome: italic `#991a30` prompt when `missing`.
- Screen Dossier status: `approved` → Live; `call==='post'` → Awaiting your approval; else Pending.
- Matches record: idle → rec → done → sent (see ambiguity).
- Sponsor moments: `visible` row vs `ghost` row per `momentsOn[mid]`.

---

## Copy, verbatim

Sentence case is intentional. No em dashes. All strings exactly as written.

**Page chrome:** `Hub` · `Student app` · jump chips: `Home` `Profile` `Sponsor view` `Call: consent`
`Call: live` `Call: review` `Matches` `Settings`.

**Home:**
- Greeting `Hey, June`; subtitle `ScottyLabs Talent · profile live`; avatar `JP`.
- PrimaryActionCard: eyebrow `One thing to do`; title `Do your Talent Rep screen`; body `30 minutes
  with our AI talent rep gets you a verified profile, a real practice report, and Premier shortlist
  eligibility.`; buttons `Start now` / `Book a slot`.
- PublishedConfirmCard: `Your Screen Dossier is live` / `Visible to 10 Premier sponsors under license`.
- StrengthMeter: `Profile strength`; value `82` (→ `88` when approved); box `Do this next: add a
  measured outcome to your Meridian internship story +4`.
- LiveMatchCard: `Live match`; tag `Shortlisted`; `SWE Intern, Infrastructure · Scogle, Inc`;
  labels `Matched` `Shortlisted` `Intro` `Interview` `Outcome`; button `Answer Scogle's follow-up
  question`.
- Ledger: header `Your data, at work`; `Full ledger`. (Row copy in Demo data.)

**Living Profile:**
- Title `Living Profile`; toggle `View as sponsor`.
- Identity: `June Park` / `SCS · BS Computer Science · May 2027` / `junepark · verified via CMU SSO`.
  Chips: `May 2027` `Internships + new grad` `Pittsburgh or SF Bay` `F-1 · CPT eligible`
  `Open to startups`.
- Talent Graph: header `Talent Graph`; hint `tap a skill to light its thread`; verified caption
  `{n} wired`; unverified caption `no proof yet`; empty state `Tap a skill on the left to trace its
  evidence thread.`; footnote `Solid chips are wired to proof; dashed claims dangle until evidence
  attaches. Sponsors see the same wiring.` Evidence captions: `Verified · {src}`, `Pending ·
  Verifier check`, `Self-reported · {src}`, `Missing · attach to verify`.
- Experience stories: section `Experience stories`; row labels `Setup` `Your part` `Outcome`.
- Screen Dossier card: `Screen Dossier`; tags `Pending` / `Awaiting your approval` / `Live`; notes
  and action labels per state (see Screen inventory). Pending/post note: `Complete your Talent Rep
  screen and approve the draft. Nothing sponsor-visible ships without your sign-off.` Live note:
  `3 audio moments visible to sponsors, stream only. You control each moment, and every play is
  logged in your ledger.` Actions: `Start the screen` / `Review the draft` / `Manage moment
  visibility`.

**Interviews:**
- Title `Interviews`.
- Approved card: `Talent Rep screen`; tag `Completed · Jul 1`; `Dossier live with 3 audio moments.
  Coaching report below is private to you, always.`; button `Retake (1 left this semester, invisible
  to sponsors)`.
- Not-approved card: `Talent Rep screen`; `Not done yet. It is the one contribution that unlocks
  Premier shortlists, and you keep the coaching report either way.`; button `Start the 30-minute
  screen`.
- Coaching entry: `Coaching Report · Jul 1`; tag `Private to you`; `Two strengths, two growth areas,
  two practice suggestions from the Coach. The Coach is on your side; the Recruiter is neutral.`;
  button `Open report + dossier review`.
- Refresher: `Semester refresher · opens Dec 8`; `A 10-minute voice check-in to log new coursework
  and your internship. Keeps your freshness date current in matching.`

**Matches:**
- Title `Matches`; role `SWE Intern, Infrastructure` / `Scogle, Inc · Pittsburgh or Kirkland`; tag
  `Shortlisted`; comp `$54/hr · Summer 2027 · CPT friendly · comp disclosed per platform policy`.
- AsyncQuestionCard: eyebrow `Follow-up from the Recruiter`; meta `2 min · voice`; question
  `"RailTrace buffered bursty writes for one rail line. What breaks first if Scogle pointed 40,000
  fleet units at it, and what would you change?"`; idle button `Tap to record your reply`; recording
  button `Done`; done `Recording captured.`; sent `Sent. It rides with your shortlist card, and you
  can hear it in your ledger.`

**Settings:**
- Title `You and your data`; section `Visibility`.
- `Searchable` — `All 10 Premier sponsors can find you. Every view is logged here.`
- `Match only` — `Invisible until shortlisted, then we ask you before revealing identity.`
- `Paused` — `Nothing new is shown to anyone. Existing intros stay open.`
- Ledger header `Data Ledger` / `every access, logged`. Buttons `Export everything` / `Delete
  account, for real`.

**Consent screen:**
- `Before we start`; agenda label `30 minutes, six parts`; panel label `The recording, plainly`.
- Panel p1: `Nothing is retained until you consent, here and again out loud on the call. You approve
  every sponsor-visible word before it ships. Audio is stream only for sponsors and auto-deletes 18
  months after your last activity.`
- Panel p2: `Pennsylvania is an all-party consent state, so the Rep will confirm again at minute
  zero.`
- Checkbox A: `I consent to this call being recorded and processed into my profile, dossier and
  coaching report.`
- Checkbox B: `I understand sponsors receive my approved dossier under license: internal recruiting
  use only, no resale, no model training, deletion on contract end.`
- Buttons: `Start the call` / `Prefer text? Take the written version instead`.

**Live call:** `REC · consented`; timer `{mm:ss} / 30:00`; center `Deep dive 2 of 2` /
`RailTrace, TartanHacks 2026`; `The Rep is listening`; speaker labels `Talent Rep` / `You`;
controls `Pause` / `Resume` / `End call`.

**Post-call:** `Two things arrived` / `Call ended at 29:12 · transcript saved`. Coaching Report:
`Coaching Report`; tag `Private to you`; group labels `What landed` / `What was vague` /
`Practice next`. Dossier: `Screen Dossier, draft`; tag `Ships only if you approve`; sub-label
`Audio moments · you control each`; `Strike a moment entirely`; `Approve and publish to sponsors`.

**Sponsor panel:** URL `talent.scottylabs.org/pool/junepark · as Jordan @ Scogle`; banner
`Premier license: internal recruiting use only, no resale, no model training. This view was just
logged to June's ledger.`; tag `SSO verified`; meta `SCS · BS Computer Science · May 2027 ·
Pittsburgh or SF Bay · F-1, CPT eligible`; sub `Profile refreshed 3 days ago · screen completed
Jul 1`; skills header `Skills, evidence-weighted`; skills footnote `Hollow chips are the candidate's
own claims. They rank lower until evidence attaches.`; dossier header `Screen Dossier · Jul 1` /
`audio is stream only, plays are logged`; ghost row `You hid "{tag}". Sponsors do not see this row
at all.`; footnote `Never in this view: your coaching report, struck moments, grades, retake
history, and anything you set to hidden. This panel is exactly what Jordan sees, nothing more.`

**Toasts (verbatim):**
- `Dossier published. Sponsors now see your approved version.`
- `Struck moments never render for sponsors, and it is not held against you.`
- `Reply sent to the Recruiter. Scogle sees it with your shortlist card.`
- `Visibility set to searchable. Effective now, including the MCP layer.` (and `match-only`, `paused`).

---

## Demo / seed data

Single seeded student: **June Park** (`junepark`), SCS, BS Computer Science, grad May 2027,
Pittsburgh or SF Bay, F-1 / CPT eligible, verified via CMU SSO, initials `JP`. Profile strength
prop default **82** (→ 88 published). Greeting "Hey, June". Sponsor viewer persona: **Jordan @
Scogle** (company Scogle, Inc, Premier).

### Skills (`skillsDef`) — id, name, verified, evidence[]
- `sk1` **Distributed systems**, verified. Evidence:
  1. `15-440 consensus project` — src `course`, prov `Verified`.
  2. `railtrace repo · authorship sampled, 14 commits` — src `repo`, prov `Verified`.
  3. `Interview moment · partition failure analysis, 14:42` — src `audio`, prov `Verified` (purple edge).
- `sk2` **Systems programming (C)**, verified. Evidence:
  1. `15-213 systems coursework` — src `course`, prov `Verified`.
  2. `Memory allocator writeup, personal site` — src `site`, prov `Self-reported`.
- `sk3` **Database internals**, verified. Evidence:
  1. `15-445 database systems` — src `course`, prov `Verified`.
- `sk4` **Go**, verified. Evidence:
  1. `railtrace · Go, 61% of 18k lines` — src `repo`, prov `Verified`.
  2. `Meridian fleet API, internship` — src `work`, prov `Pending` (amber edge).
- `sk5` **React**, unverified. Evidence: 1. `Claimed on resume only` — src `missing`, prov `Self-reported`.
- `sk6` **Kubernetes**, unverified. Evidence: 1. `Homelab, described in interview` — src `missing`, prov `Self-reported`.
- Derived chip captions: verified → "{ev.length} wired" (sk1 "3 wired", sk2 "2 wired", sk3 "1 wired",
  sk4 "2 wired"); unverified → "no proof yet". Sponsor pill count = "×{ev.length}" (verified only).
- Default expanded skill: `sk1`.

### Experience stories (`storiesDef`)
1. **Backend intern · Meridian Robotics** — when `Summer 2025`. Setup: `Fleet telemetry service
   was dropping location updates during depot wifi handoffs.` Your part: `Designed and shipped a
   store-and-forward buffer with idempotent replay, wrote the Go client library other teams
   adopted.` Outcome (**missing → italic #991a30**): `Add a measured outcome. What happened to the
   drop rate?`
2. **RailTrace · TartanHacks 2026, 1st place** — when `Feb 2026`. Setup: `Pittsburgh Regional
   Transit publishes light-rail positions with 90 second lag and frequent gaps.` Your part: `Built
   the ingestion pipeline and dead-reckoning model solo; two teammates did the map UI.` Outcome:
   `1,400 weekly riders during demo month; judged best technical depth of 63 teams.`
3. **Consensus under partition · 15-440** — when `Fall 2025`. Setup: `Course project: Raft-based
   replicated key-value store, graded against injected network partitions.` Your part: `Owned
   election and persistence modules (about 1,100 lines), co-wrote the replay test harness.`
   Outcome: `Survived all 500 adversarial partition schedules; top 5 of 84 teams on the robustness
   leaderboard.`

### Logistics chips
`May 2027`, `Internships + new grad`, `Pittsburgh or SF Bay`, `F-1 · CPT eligible`, `Open to
startups` (5 chips).

### Match / role
`SWE Intern, Infrastructure` at `Scogle, Inc`, `Pittsburgh or Kirkland`, comp `$54/hr`,
`Summer 2027`, `CPT friendly`. Status `Shortlisted`. Company glyph letter `S`. Timeline steps:
`Matched`(done) `Shortlisted`(done) `Intro`(pending) `Interview`(pending) `Outcome`(pending).

### AsyncQuestion
Question text (verbatim above). Auto-record cap 14s. Timer format "{n.n}s".

### Agenda (6 rows)
`01` `Consent + warm-up` `2 min`; `02` `Resume walkthrough, gaps only` `6 min`; `03` `Two
experience deep-dives` `12 min`; `04` `Domain drill, calibrated to 15-440` `6 min`; `05` `Logistics
+ what great looks like` `3 min`; `06` `Wrap, what happens next` `1 min`.

### Captions transcript (`captions()`, 9 turns, in order)
1. rep: `Let's go deeper on the 15-440 project. You said the consensus layer failed under partition.
   Walk me through how you found it.`
2. you: `So our Raft implementation kept electing two leaders when we injected a network partition
   in the test harness...`
3. you: `I suspected our election timeout was misconfigured, but logging showed both nodes had valid
   terms. The real bug was that we persisted votedFor after the term check, not atomically with it.`
4. rep: `Nice. What did you actually change, and how did you prove the fix instead of just re-running
   until green?`
5. you: `I wrote the vote record as a single fsync'd tuple, then added a Jepsen-style checker that
   replayed the exact partition schedule 500 times. Zero split votes after.`
6. rep: `You said 'our implementation'. Which parts of the consensus code did you personally write?`
7. you: `The election module and the persistence layer were mine, about 1,100 lines. My partner
   owned log replication. We co-wrote the test harness.`
8. rep: `If you rebuilt it today, what would you do differently?`
9. you: `Honestly, I'd model the state machine in TLA+ first. We lost a week to a bug a spec would
   have caught in an afternoon.`

### Live-call section labels (arc)
`Consent`, `Walkthrough`, `Deep dive 1`, `Deep dive 2`, `Domain`, `Wrap`. Center display fixed:
`Deep dive 2 of 2` / `RailTrace, TartanHacks 2026`. Done: 0–2; active: 3; upcoming: 4–5.

### Clips / audio moments (`clips()`, 3)
- `c1` **Debugging under pressure** — dur 8s (`0:08`); quote `The real bug was that we persisted
  votedFor after the term check, not atomically with it.`
- `c2` **Verification instinct** — dur 7s (`0:07`); quote `Replayed the exact partition schedule
  500 times. Zero split votes after.`
- `c3` **Ownership clarity** — dur 6s (`0:06`); quote `The election module and the persistence
  layer were mine, about 1,100 lines.`
- Mapped to moment ids `m1`, `m2`, `m3` (all sponsor-visible by default; `m4` in state is unused).

### Competency matrix (`competency`, 4 rows — 5-dot scale)
- `Technical depth` — dots [1,1,1,1,1] — link `moment 0:42`.
- `Verification instinct` — dots [1,1,1,1,1] — link `moment 6:18`.
- `Ownership clarity` — dots [1,1,1,1,0] — link `moment 11:05`.
- `Communication` — dots [1,1,1,1,0] — link `full transcript`.

### Coaching report
- What landed (2): `Your failure analysis is precise and unprompted. The votedFor walkthrough is a
  model answer: symptom, hypothesis, evidence, fix, proof.` · `You quantify outcomes without being
  asked. 500 replays, 1,100 lines, 63 teams. Keep that habit.`
- What was vague (2): `You said "we" nine times before claiming your own work on RailTrace. Lead
  with your part, then credit the team.` · `The tradeoff question got a list, not a decision. Strong
  answers pick one and defend the cost.`
- Practice next (2): `Rehearse a 90-second Meridian story that ends with a number. You have the
  material, it is just unstated.` · `Practice one "what would you do differently" answer that names
  a tool you did not use and why you would now.`

### Data Ledger (`ledgerAll`, 6 rows) — Home shows first 4
| chip | chipBg | chipFg | kind | text | when |
|---|---|---|---|---|---|
| `SG` | #063f58 | #fff | View | `Scogle, Inc viewed your profile under Premier license` | `Today, 9:41 AM` |
| `VF` | #e7f5fa | #0a6b94 | Verify | `Verifier confirmed you authored railtrace (14 commits sampled)` | `Yesterday` |
| `SL` | #dcefe0 | #0d4b17 | Shortlist | `Included in a shortlist: SWE Intern, Infrastructure at Scogle` | `Mon, Jun 29` |
| `EX` | #f3ecd2 | #654a00 | Export | `Scogle exported your dossier PDF (watermarked, logged)` | `Mon, Jun 29` |
| `SG` | #063f58 | #fff | Stream | `Scogle streamed 2 audio highlights from your screen` | `Sun, Jun 28` |
| `YOU` | #f0f4f8 | #4a5662 | Edit | `You updated availability to Summer 2027` | `Jun 21` |

(Home preview uses the 2–3 letter `chip`; Settings ledger uses the `kind` word as the tag, colored
with the same bg/fg.)

### Visibility options
`searchable` (label "Searchable", default selected) · `match-only` (label "Match only") · `paused`
(label "Paused"). Descriptions in Copy.

---

## SVG & iconography

All icons are `viewBox="0 0 24 24"`, `fill:none` unless noted, `stroke:currentColor` (or explicit),
`stroke-linecap:round; stroke-linejoin:round`. Production should use **lucide-react**.

| Use | Size / stroke | Path(s) | Lucide |
|---|---|---|---|
| Hub back link | 14, sw2 | `M19 12H5` + `m12 19-7-7 7-7` | `ArrowLeft` |
| View as sponsor / eye | 14, sw2 | `M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z` + `<circle cx=12 cy=12 r=3>` | `Eye` |
| Published check (Home) | 16, sw2.2, stroke #0e96d1 | `M20 6 9 17l-5-5` | `Check` |
| Do-this-next plus | 15, sw2, stroke #0a6b94 | `M5 12h14` + `M12 5v14` | `Plus` |
| Record mic / Interviews tab | 14 (rec) / 22 (tab), sw2 | `M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z` + `M19 12a7 7 0 0 1-14 0M12 19v3` | `Mic` |
| Close (X) | 14, sw2, stroke #4a5662 | `M18 6 6 18M6 6l12 12` | `X` |
| Consent check (white) | 11, sw3.5, stroke #fff | `M20 6 9 17l-5-5` | `Check` |
| Sent check (green) | 15, sw2.4, stroke #0d4b17 | `M20 6 9 17l-5-5` | `Check` |
| License shield | 13, sw2, stroke #0a6b94 | `M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z` | `Shield` |
| Never-in-view lock | 14, sw2, stroke #5f6f7f | `<rect x=3 y=11 width=18 height=10 rx=2>` + `M7 11V7a5 5 0 0 1 10 0v4` | `Lock` |
| Ghost hidden eye-off | 14, sw2, stroke #869db3 | `M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19` + `m1 1 22 22` | `EyeOff` |
| Moment play (filled) | 12 (post) / 11 (sponsor), fill #fff | `M7 4.5v15l13-7.5z` | `Play` |
| Moment pause (filled) | 12 / 11, fill #fff | `<rect x=5 y=4 width=4.5 height=16 rx=1.5>` + `<rect x=14.5 y=4 width=4.5 height=16 rx=1.5>` | `Pause` |
| Home tab | 22, sw1.9 | `M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z` | `Home` |
| Profile tab | 22, sw1.9 | `M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10c0-3.9 3.1-7 7-7s7 3.1 7 7` | `User` |
| Matches tab | 22, sw1.9 | `M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z` | `Briefcase` |
| You/Settings tab | 22, sw1.9 | `M4 8h10M18 8h2M4 16h2M10 16h10M14 5.5 M16 8a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM8 16a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z` | `SlidersHorizontal` (approx) |

**Progress arc** — not an icon; 6 `<path>` elements, geometry and per-state stroke in CallRoomLive.
**Voice bars** — 24 `<span>` elements (live) / same array in record pill; not SVG.

---

## Accessibility & floors

From the handoff plus what the source enforces:
- **Tap targets 44px** minimum for primary actions. Source primary pills: 44–48px (Start now,
  Start the call 48, Approve 46, Tap to record 46). Some secondary/utility controls fall below:
  close buttons 34px, Retake 38px, tab-bar hit rows ~40px, visibility switch 40×23px, "Done"
  34px, moment play 32–34px, jump chips 30px. Bring the sub-44 interactive controls up to a 44px
  hit area in production even if the visual stays small.
- **Type-size floors**: student app body **12.5px minimum** (most body copy is 12.5px; watch the
  smaller mono captions at 10–11px and the 8.5px evidence-card caption and 9px chip captions —
  these are labels/eyebrows, not body, but verify contrast). Sponsor tables 12px minimum.
- **Contrast**: provenance grammar must never shame — verified = solid border + blue tint,
  self-reported = dashed/hollow, pending = amber, audio moment = purple edge, missing = dashed gray
  at reduced opacity (75%). Muted grays (#869db3, #aebdcc) are used only for secondary text/labels.
- **Motion**: honor reduced-motion (voice bars, slpulse/slfade, waveform) — the handoff flags a
  reduced-motion pass as not-yet-designed; disable the looping bar animations and enter transitions
  under `prefers-reduced-motion`.
- **Captions/live region**: the call caption stream should be an ARIA live region in production
  (driven from ASR partials). Speaker labels ("Talent Rep" / "You") must remain programmatically
  associated with each bubble.
- Consent gating: the "Start the call" button is disabled (`#c7d2dc`) until both checkboxes are
  checked — expose real `disabled`/`aria-disabled`, not just color.

---

## Simulated-only / decisions for implementers
- **Timers & captions**: `callT`, `mmss` (offset +872s), `capIdx` window, voice bars — all
  simulated. Production drives from the interview state machine + ASR partials. The mmss/caption
  offset mismatch is a prototype artifact; do not replicate it.
- **Audio playback**: clip progress is a client timer; production streams from presigned URLs with
  real word timestamps, every play logged to the ledger. Clips are stream-only, never downloadable.
- **`recState==='done'` dead-end**: if the reply recording auto-completes at 14s it shows
  "Recording captured." with no send button (only the in-progress state has "Done"→send). Decide
  the production behavior (auto-send, or surface a send button in the done state).
- **`momentsOn.m4`** exists in state but there is no 4th moment; drop it. **`dossierTab`** is unused
  here. **Book a slot**, **text-mode link**, **Export everything**, **Delete account** have no
  handlers — wire to real flows (booking, text interview, data export, account deletion).
- Toast duration is 2600ms in source (README says ~2.8s) — use 2600ms.
- The sponsor skills pill list reuses the same `skills` array, so the currently-expanded skill
  renders solid dark (`#063f58`) in the sponsor view too. If unintended, decouple sponsor skill
  styling from `expandedSkill` in production.
