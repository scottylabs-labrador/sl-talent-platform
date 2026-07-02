# Sponsor Portal — implementation spec

Source prototype: `design_files/Sponsor Portal.dc.html`. Target: React + TypeScript, Next.js App Router, `lucide-react`.

This is the desktop sponsor surface. It is a single-page shell (persistent 64px header + 208px sidebar) whose main pane swaps between three views (Dashboard, Role intake, Shortlist) plus a full-screen DossierView modal and a bottom-center toast. All data and timers in the prototype are simulated client-side; production wires them to the Recruiter/Concierge agents and presigned audio. See the handoff README for cross-surface tokens and the tartan grammar; this file adds the exact per-component detail.

Everything below is quoted verbatim from the prototype where load-bearing. Sentence case in copy is intentional. No em dashes in product copy. Course numbers are hyphenated (15-440).

---

## Screen inventory

The portal never navigates the browser; it is one persistent shell with a `view` state variable and modal overlays. Layout is: `<header 64px>` sticky on top, then a flex row of `<aside 208px>` + `<main flex:1>`. The dossier modal and toast are fixed overlays outside that row.

| # | Screen / state | How you reach it | What it shows |
|---|---|---|---|
| 1 | **Dashboard** (`view:'dashboard'`, default) | Sidebar "Dashboard", or nav reset | Greeting, 4 stat tiles, "Your roles" table (3 rows with SLA chips), Concierge suggestion card |
| 2 | **Role intake** (`view:'roles'`) | Sidebar "Roles"; "Post a role" button; roleRows "View intake"/"Resume intake"; shortlist header "View intake" | Two-column: left scripted chat thread with composer; right sticky live requirements summary + SLA line |
| 3 | **Shortlist** (`view:'shortlist'`) | Sidebar "Shortlist"; roleRows "Review shortlist"; goShortlist | Tartan header card + funnel line, 10 CandidateCards, honesty footer |
| 4 | **DossierView modal** (`dossier != null`) | Any candidate name button or "Open dossier →" | 880px modal with tartan spine; June Park (`p1`) shows 4 tabs (Summary/Evidence/Screen/Logistics), all others show rationale + scope note |
| 5 | **Stubbed nav targets** (`search`, `pipeline`, `api`, `analytics`) | Sidebar rows tagged "P2" | Do NOT switch view; fire a toast "\<label\> ships in phase 2. The Concierge can answer most of it today." |
| 6 | **Toast** (`toast != null`) | Every consequential action | Bottom-center black pill, auto-dismiss 3000ms |

Intra-screen sub-states:
- **Role intake** has 4 conversation steps (`intakeStep` 0→3) that reveal messages, swap the composer control, and flip summary rows. See state machine.
- **Shortlist** each card has a per-candidate status (`none`/`intro`/`passed`/`saved`) and an inline pass-reason row (`passOpen`).
- **DossierView** has a tab state (`dossierTab`) and, on the Screen tab, an audio player with clip selection (`selClip`) and playback (`playing`,`playT`).

Navigation notes: clicking any active nav row sets `{view:n.id, dossier:null}` (also closes an open dossier). The header "Hub" link points at `Talent Hub.dc.html` (prototype-only cross-link; in production route to the hub or omit). Content max-width is 1160px inside the main pane; the portal is designed for 1280px+ and responsive behavior below 1100px is explicitly out of scope (flag for design).

---

## Component tree

```
<SponsorPortalShell>                      // holds `view`, `toast`, modal state
├─ <PortalHeader>                         // 64px, sticky
│  ├─ <HubBackLink>                       // arrow-left + "Hub"
│  ├─ <BrandGlyphTile size=34 />          // conic-gradient tile + Scotty monogram
│  ├─ <BrandLockup>                       // "ScottyLabs Talent" + sponsor caption
│  ├─ <LicensePill />
│  ├─ <AskConciergeButton />              // black pill, fires pingConcierge toast
│  └─ <UserAvatar>J</UserAvatar>
├─ <PortalSidebar>                        // 208px
│  ├─ <NavRow>×7                          // 3 active + 4 P2-stubbed
│  └─ <RoleSlotMeter />                   // "3 / 10", 30% fill, "Premier · renews Aug 2026"
├─ <MainPane>
│  ├─ <DashboardView>                     // view==='dashboard'
│  │  ├─ <DashboardHeader> + <PostRoleButton/>
│  │  ├─ <StatTile>×4                     // grid repeat(4,1fr)
│  │  ├─ <RolesTable>                     // header + <RoleRow>×3 (SLA chip + action pill)
│  │  └─ <ConciergeCard>                  // glyph + <ConciergeChip>×3
│  ├─ <RoleIntakeView>                    // view==='roles'
│  │  ├─ <IntakeChatPanel>                // <IntakeMessage>×N + <IntakeComposer>
│  │  └─ <RequirementsSummary>            // sticky; <SummaryRow>×6 + <SlaRow/>
│  └─ <ShortlistView>                     // view==='shortlist'
│     ├─ <ShortlistHeaderCard>            // 10px tartan band + funnel line + 2 pills
│     ├─ <CandidateCard>×10               // rank/avatar/name/badge/why/chips/actions/fit
│     │  └─ <PassReasonRow>               // inline, conditional
│     └─ <HonestyFooter />
├─ <DossierView>                          // modal, dossier!=null
│  ├─ <DossierHeader>                     // avatar, name, SSO tag, meta, close
│  ├─ <DossierTabs>                       // June only
│  │  ├─ <SummaryTab>                     // rationale + CompetencyMatrix + FlagList + FollowUps
│  │  ├─ <EvidenceTab>                    // <EvidenceStoryCard>×3 + provenance note
│  │  ├─ <ScreenTab>                      // canonical <AudioHighlightPlayer/> + <ClipRow>×3
│  │  └─ <LogisticsTab>                   // <LogisticsRow>×5
│  └─ <DossierScopeNote>                  // non-June fallback: rationale + dashed note
└─ <Toast />                              // fixed bottom-center
```

Reusable primitives to extract: `<BrandGlyphTile>` (used at 34px in header, 30px in Concierge card, 15px monogram), `<TartanBand>` (horizontal 10px on shortlist header, vertical 12px on dossier spine), `<Pill>` (100px radius everywhere), `<ProvenanceTag>`, `<StatusChip>`.

Named per handoff: `CandidateCard`, `DossierView`, `PrimaryActionCard`/`StrengthMeter`/`AsyncQuestionCard` are student-app names (not on this surface). This surface's canonical components are the Shortlist `CandidateCard`, `DossierView`, and the audio player ("option 2a").

---

## Exact styles per component

Global: `body { margin:0; background:#f0f4f8; }`. Shell root: `min-height:100vh; font-family:Inter,ui-sans-serif,system-ui,sans-serif; color:#1e1e1e; display:flex; flex-direction:column;`.

Fonts: **Satoshi** (display titles, 700, letter-spacing -0.02em), **Inter** (all UI), **JetBrains Mono** (stats, timestamps, scores, slot count). Load Satoshi 400/500/700/900 and Inter 400/500/600/700 and JetBrains Mono 400/500/600.

### Header (`PortalHeader`)
`height:64px; background:#edf1f6; border-bottom:1px solid #d9e1e7; display:flex; align-items:center; justify-content:space-between; padding:0 24px; position:sticky; top:0; z-index:60;`

- Left cluster: `display:flex; align-items:center; gap:14px;`
- **Hub link** (`<a>`): `text-decoration:none; color:#4a5662; font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px;` — arrow-left SVG 14×14 + text "Hub".
- **Divider**: `width:1px; height:20px; background:#c7d2dc;`
- **Brand glyph tile**: `width:34px; height:34px; border-radius:9px; box-shadow:inset 0 -5px 12px rgba(0,0,0,.25);` flex-centered. Background = conic glyph gradient (see SVG section). Monogram SVG inside: `width:18px; height:16px; fill:#fff;`.
- **Brand lockup** (`display:flex; flex-direction:column; gap:1px;`): "ScottyLabs Talent" `font-family:Satoshi,Inter,sans-serif; font-weight:700; font-size:15px; letter-spacing:-0.02em;` + "Sponsor portal · Scogle, Inc · Premier" `font-size:10.5px; color:#5f6f7f;`.
- Right cluster: `display:flex; align-items:center; gap:12px;`
- **License pill**: `font-size:11px; color:#5f6f7f; border:1px solid #c7d2dc; border-radius:100px; padding:6px 12px;`.
- **Ask the Concierge button**: `height:36px; padding:0 16px; border-radius:100px; border:none; background:#1e1e1e; color:#fff; font:600 12.5px Inter; cursor:pointer; display:flex; align-items:center; gap:7px;` hover `background:#383838`. Contains message-square SVG 13×13 (stroke #fff, width 2) + "Ask the Concierge".
- **User avatar**: `width:34px; height:34px; border-radius:50%; background:#6940c9; color:#fff; font:600 13px Inter;` flex-centered, letter "J".

### Sidebar (`PortalSidebar`)
`width:208px; flex:none; background:#edf1f6; border-right:1px solid #d9e1e7; padding:20px 10px 16px; display:flex; flex-direction:column; gap:2px;`

- **NavRow** (button): `display:flex; align-items:center; gap:11px; padding:10px 13px; border-radius:8px; border:none; cursor:pointer; text-align:left; font:<wt> 13.5px Inter;` hover `background:#e3e9f0`.
  - Active (`view===id`): `background:#fff; color:#0e96d1; font-weight:600;`
  - Inactive: `background:transparent; color:#38424b; font-weight:500;`
  - Icon SVG 17×17 (viewBox 0 0 24 24, stroke currentColor, stroke-width 1.75, `flex:none`).
  - Label span `flex:1`.
  - P2 badge (stubbed rows only): `font-size:9px; font-weight:600; letter-spacing:.05em; color:#869db3; border:1px solid #c7d2dc; border-radius:4px; padding:2px 5px;` text "P2".
- **RoleSlotMeter**: `margin-top:auto; border-top:1px solid #d9e1e7; padding:14px 13px 4px; display:flex; flex-direction:column; gap:6px;`
  - Row: `display:flex; justify-content:space-between; font-size:11px; color:#5f6f7f;` — "Role slots" + "3 / 10" (`font-family:'JetBrains Mono',monospace;`).
  - Track: `height:5px; border-radius:100px; background:#d9e1e7; overflow:hidden;` → fill `height:100%; width:30%; background:#0e96d1; border-radius:100px;`.
  - Caption: "Premier · renews Aug 2026" `font-size:10.5px; color:#869db3;`.

### MainPane
`flex:1; min-width:0; display:flex; flex-direction:column;`. Each view wrapper is `max-width:1160px` with `animation:slfade 240ms cubic-bezier(.2,0,0,1);`.

### Dashboard
Wrapper: `padding:30px 36px 48px; display:flex; flex-direction:column; gap:22px;`.
- **Header row**: `display:flex; align-items:flex-end; justify-content:space-between;`. Left col gap:4px: "Morning, Jordan" `font-family:Satoshi; font-weight:700; font-size:28px; letter-spacing:-0.02em;` + subtitle `font-size:13px; color:#5f6f7f;`. **Post a role button**: `height:40px; padding:0 20px; border-radius:100px; border:none; background:#1e1e1e; color:#fff; font:600 13px Inter;` hover `#383838` (→ goRoles).
- **Stat grid**: `display:grid; grid-template-columns:repeat(4,1fr); gap:14px;`. Tile: `background:#fff; border:1px solid #e9ebf8; border-radius:12px; padding:16px 18px; display:flex; flex-direction:column; gap:4px; box-shadow:0 1px 2px rgba(30,30,30,.04);`. Number `font-family:'JetBrains Mono'; font-size:24px; font-weight:600; color:#1e1e1e;`; label `font-size:12px; line-height:1.4; color:#5f6f7f;`.
- **RolesTable card**: `background:#fff; border:1px solid #e9ebf8; border-radius:12px; overflow:hidden; box-shadow:0 1px 2px rgba(30,30,30,.04);`. Header `padding:15px 20px; border-bottom:1px solid #e9ebf8; display:flex; align-items:center; justify-content:space-between;` — "Your roles" `font-size:14px; font-weight:600;` + "shortlist SLA: 72 hours from confirm" `font-size:11.5px; color:#869db3;`.
  - **RoleRow**: `display:flex; align-items:center; gap:16px; padding:15px 20px; border-bottom:1px solid #f0f3f9;`. Name/meta col `flex:1; min-width:0; gap:2px;` (name 14px/600, meta 12px #869db3). Status `font-size:12.5px; color:#4a5662; flex:1.2;`. **SLA chip** `font-size:11px; font-weight:600; color:<slaFg>; background:<slaBg>; border-radius:4px; padding:4px 9px; flex:none;`. Action button `height:34px; padding:0 16px; border-radius:100px; border:1px solid #c7d2dc; background:#fff; font:600 12px Inter; color:#1e1e1e; flex:none;` hover `border-color:#869db3; background:#f8fafc`.
- **ConciergeCard**: `background:#fff; border:1px solid #e9ebf8; border-radius:12px; padding:18px 20px; display:flex; flex-direction:column; gap:12px; box-shadow:0 1px 2px rgba(30,30,30,.04);`. Header row gap:10px: 30px glyph tile (`width:30px; height:30px; border-radius:8px;` conic gradient, monogram SVG 15×13 fill #fff) + text col ("Concierge" 13.5px/600 + caption 11.5px #869db3). Chips row `display:flex; gap:8px; flex-wrap:wrap;`. **ConciergeChip** `height:34px; padding:0 15px; border-radius:100px; border:1px solid #c7d2dc; background:#f8fafc; font:500 12.5px Inter; color:#38424b;` hover `border-color:#0e96d1; color:#0a6b94`.

### Role intake
Wrapper: `padding:30px 36px 48px; display:flex; flex-direction:column; gap:18px;`. Header col gap:4px: "Role intake" Satoshi 700 28px + subtitle 13px #5f6f7f. Grid: `display:grid; grid-template-columns:1.5fr 1fr; gap:18px; align-items:start;`.
- **IntakeChatPanel**: `background:#fff; border:1px solid #e9ebf8; border-radius:12px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 1px 2px rgba(30,30,30,.04);`.
  - Header: `padding:13px 18px; border-bottom:1px solid #e9ebf8; display:flex; align-items:center; gap:8px;` — green dot `width:8px; height:8px; border-radius:50%; background:#3a9a4c;` + "SWE Intern, Infrastructure · intake thread" 13px/600.
  - Messages area: `padding:18px; display:flex; flex-direction:column; gap:12px; min-height:340px;`.
  - **IntakeMessage**: `display:flex; flex-direction:column; gap:3px; align-self:<align>; max-width:82%; animation:slfade 220ms cubic-bezier(.2,0,0,1);`. Who label `font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:#869db3; padding:0 6px;`. Bubble `font-size:13px; line-height:1.55; color:#1e1e1e; background:<bg>; border:1px solid <bd>; border-radius:12px; padding:10px 14px;`. Sponsor ("me"): `align-self:flex-end; bg:#e7f5fa; bd:#b4def1`. Concierge: `align-self:flex-start; bg:#fff; bd:#e9ebf8`.
  - **IntakeComposer**: `padding:14px 18px; border-top:1px solid #e9ebf8; background:#f8fafc; display:flex; gap:10px; align-items:center;`. Contents swap by step (see state machine):
    - Reply state: ghost input `flex:1; font-size:12.5px; color:#869db3; font-style:italic; border:1px solid #e0e6ee; border-radius:100px; padding:11px 16px; background:#fff;` (shows the next scripted line) + Send button `height:40px; padding:0 20px; border-radius:100px; border:none; background:#1e1e1e; color:#fff; font:600 13px Inter;` hover `#383838`.
    - Confirm state: full-width button `flex:1; height:44px; border-radius:100px; border:none; background:#0e96d1; color:#fff; font:600 13.5px Inter;` hover `background:#0d89be`.
    - Done state: `flex:1; display:flex; align-items:center; gap:9px; background:#dcefe0; border-radius:100px; padding:11px 16px;` — check SVG 14×14 (stroke #0d4b17, width 2.4) + text 12.5px #0d4b17/600.
- **RequirementsSummary** (right): `background:#fff; border:1px solid #e9ebf8; border-radius:12px; overflow:hidden; box-shadow:0 1px 2px rgba(30,30,30,.04); position:sticky; top:88px;`. Header `padding:13px 18px; border-bottom:1px solid #e9ebf8;` — "The role, as the platform understands it" 13px/600. Body `padding:16px 18px; display:flex; flex-direction:column; gap:12px;`.
  - **SummaryRow**: `display:flex; gap:10px; align-items:flex-start;`. Dot `width:8px; height:8px; border-radius:50%; background:<dotBg>; flex:none; margin-top:5px;` (ok → #3a9a4c, open → #e8b13a). Text col gap:1px: key `font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:#869db3;` + value `font-size:12.5px; line-height:1.5; color:#1e1e1e;`.
  - **SlaRow**: `border-top:1px solid #e9ebf8; padding-top:12px; display:flex; align-items:center; gap:9px;` — clock SVG 15×15 (stroke `<slaColor>`, width 2) + line `font-size:12.5px; font-weight:600; color:<slaColor>;` (`#869db3` before confirm, `#0d4b17` after).

### Shortlist
Wrapper: `padding:30px 36px 60px; display:flex; flex-direction:column; gap:16px;`.
- **ShortlistHeaderCard**: `background:#fff; border:1px solid #e9ebf8; border-radius:14px; overflow:hidden; box-shadow:0 2px 8px rgba(30,30,30,.06);`.
  - **Tartan band** (`height:10px`): `background-color:#063f58; background-image:repeating-linear-gradient(90deg, rgba(215,36,68,.6) 0 6px, transparent 6px 30px, rgba(255,255,255,.18) 30px 32px, transparent 32px 60px), repeating-linear-gradient(0deg, rgba(14,150,209,.5) 0 2.5px, transparent 2.5px 8px);`. NOTE: this is the prototype's actual recipe and differs from the README canonical (5/26/28/52 + 2/7). Use THIS recipe for pixel fidelity on this card.
  - Body: `padding:20px 24px; display:flex; align-items:center; gap:18px; flex-wrap:wrap;`. Left text col `flex:1; min-width:260px; gap:3px;`: eyebrow "Shortlist · delivered in 41h of the 72h SLA" `font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:#0a6b94;`; title "SWE Intern, Infrastructure" Satoshi 700 24px ls -0.02em; funnel line `font-size:12.5px; color:#5f6f7f;`. Right buttons col `flex:none; gap:8px;`: two pills `height:38px; padding:0 18px; border-radius:100px; border:1px solid #c7d2dc; background:#fff; font:600 12.5px Inter; color:#1e1e1e;` hover `border-color:#869db3` — "Recalibrate + rerun" (→recal) and "View intake" (→goRoles).
- **Candidate list**: `display:flex; flex-direction:column; gap:12px;`.
- **CandidateCard**: `background:#fff; border:1px solid #e9ebf8; border-radius:12px; padding:18px 22px; display:flex; gap:18px; align-items:flex-start; box-shadow:0 1px 2px rgba(30,30,30,.04); opacity:<dim>; transition:opacity 180ms;` (dim = `.45` if passed, else `1`).
  - Rank: `font-family:'JetBrains Mono'; font-size:15px; font-weight:600; color:#aebdcc; width:24px; text-align:right; flex:none; padding-top:6px;`.
  - Avatar: `width:44px; height:44px; border-radius:12px; background:<avBg>; color:#fff; font:600 15px Inter; flex:none;` flex-centered (avBg = `#c7d2dc` for anon, else `#063f58`), shows `init`.
  - Middle col `flex:1; min-width:0; gap:7px;`:
    - Name row `display:flex; align-items:center; gap:9px; flex-wrap:wrap;`: name button `border:none; background:none; padding:0; font:600 15.5px Inter; color:#1e1e1e; letter-spacing:-0.01em;` hover `color:#0e96d1`; badge (if not full) `font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:<badgeFg>; background:<badgeBg>; border-radius:4px; padding:3px 7px;`; meta `font-size:12px; color:#869db3;`.
    - Why: `font-size:13px; line-height:1.55; color:#38424b; max-width:640px;`.
    - Chips row `display:flex; gap:6px; flex-wrap:wrap;` — each chip `font-size:11px; font-weight:500; color:#0a6b94; background:#e7f5fa; border:1px solid #b4def1; border-radius:4px; padding:4px 8px;`.
    - **PassReasonRow** (when `passOpen===id`): `display:flex; gap:6px; flex-wrap:wrap; align-items:center; background:#f8fafc; border:1px dashed #c7d2dc; border-radius:8px; padding:9px 12px;` — label "Why pass? Feeds calibration:" `font-size:11.5px; color:#5f6f7f; font-weight:600;` + reason buttons `height:28px; padding:0 12px; border-radius:100px; border:1px solid #c7d2dc; background:#fff; font:500 11.5px Inter; color:#38424b;` hover `border-color:#d72444; color:#c4213e`.
  - Right actions col `display:flex; flex-direction:column; align-items:flex-end; gap:9px; flex:none;`:
    - "fit \<score\>" `font-family:'JetBrains Mono'; font-size:12px; color:#5f6f7f;`.
    - Actions row `display:flex; gap:7px;` (when status `none`): **Request intro** `height:34px; padding:0 16px; border-radius:100px; border:none; background:#1e1e1e; color:#fff; font:600 12px Inter;` hover `#383838`; **Pass** `height:34px; padding:0 14px; border-radius:100px; border:1px solid #c7d2dc; background:#fff; font:600 12px Inter; color:#4a5662;` hover `border-color:#d72444; color:#c4213e`; **Save** same as Pass but hover `border-color:#869db3`.
    - Status chips replace the row: Intro → `height:34px; padding:0 14px; border-radius:100px; background:#dcefe0; color:#0d4b17; font:600 12px Inter;` text "Intro requested ✓"; Passed → `background:#f0f4f8; color:#5f6f7f;` text "Passed"; Saved → `background:#e7f5fa; color:#0a6b94;` text "Saved".
    - "Open dossier →" `border:none; background:none; padding:0; font:600 12px Inter; color:#0e96d1;`.
  - Badge palette: Wildcard → text "Wildcard slot", bg `#d1c4ee`, fg `#4b2d8f`; Alum → "Alum", bg `#e7f5fa`, fg `#0a6b94`; Match-only → "Match-only", bg `#f0f4f8`, fg `#5f6f7f`.
- **HonestyFooter**: "When fewer than ten clear the bar, you get fewer than ten with a note. Padding is how trust dies, so we do not." `font-size:12px; color:#869db3; padding:0 4px;`.

### DossierView modal
Overlay: `position:fixed; inset:0; z-index:80; background:rgba(6,14,20,.52); display:flex; align-items:center; justify-content:center; padding:32px;` (onClick → closeDossier).
Modal: `width:880px; max-width:96vw; max-height:90vh; background:#fff; border-radius:16px; overflow:hidden; display:flex; box-shadow:0 24px 64px rgba(6,14,20,.4); animation:slfade 220ms cubic-bezier(.2,0,0,1);` (onClick → stopPropagation).
- **Tartan spine** (left edge): `width:12px; flex:none; background-color:#063f58; background-image:repeating-linear-gradient(0deg, rgba(215,36,68,.6) 0 6px, transparent 6px 30px, rgba(255,255,255,.18) 30px 32px, transparent 32px 60px), repeating-linear-gradient(90deg, rgba(14,150,209,.5) 0 2.5px, transparent 2.5px 8px);` (axes swapped vs the shortlist band so the tartan runs vertically).
- Content col: `flex:1; min-width:0; display:flex; flex-direction:column;`.
- **DossierHeader**: `padding:20px 24px 14px; border-bottom:1px solid #e9ebf8; display:flex; align-items:center; gap:14px;`. Avatar `width:48px; height:48px; border-radius:13px; background:<avBg>; color:#fff; font:600 17px Inter; flex:none;`. Name col `flex:1; gap:3px;`: name row gap:9px = name Satoshi 700 20px ls -0.015em + "SSO verified" tag `font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:#0a6b94; background:#e7f5fa; border:1px solid #90cfea; border-radius:4px; padding:2px 6px;`; meta "\<meta\> · rank \<rank\> of 10 · fit \<score\>" `font-size:12.5px; color:#5f6f7f;`. Close button `width:36px; height:36px; border-radius:50%; border:1px solid #c7d2dc; background:#fff; flex:none;` hover `border-color:#869db3`, X SVG 15×15 (stroke #4a5662, width 2).
- **DossierTabs** (June only): `padding:12px 24px 0; display:flex; gap:8px;`. Tab button `height:32px; padding:0 16px; border-radius:100px; border:1px solid <bd>; background:<bg>; color:<fg>; font:600 12px Inter;`. Active: `bg #1e1e1e; fg #fff; bd #1e1e1e`. Inactive: `bg #fff; fg #4a5662; bd #c7d2dc`. Labels: Summary / Evidence / Screen / Logistics.
- **Tab content area**: `flex:1; overflow:auto; padding:18px 24px 24px;`.

**Summary tab** (`container gap:16px`):
- Rationale panel: `background:#f8fafc; border:1px solid #e9ebf8; border-radius:10px; padding:14px 16px; display:flex; flex-direction:column; gap:5px;` — eyebrow "Why ranked 1 · the Recruiter's rationale" `font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#0a6b94;` + body `font-size:13.5px; line-height:1.6; color:#1e1e1e;` (= June's `why` + " Ratings below link to the exact minute of evidence; nothing here is unexplainable.").
- Two-col grid `display:grid; grid-template-columns:1fr 1fr; gap:16px;`:
  - Left "Competency, rated on the public rubric" (label `font-size:12px; font-weight:600; color:#869db3; letter-spacing:.06em; text-transform:uppercase;`, col gap:9px). **CompetencyRow** `display:flex; align-items:center; gap:10px;`: name `font-size:13px; color:#1e1e1e; flex:1;`; dots `display:flex; gap:3px;` each `width:9px; height:9px; border-radius:50%; background:<#0e96d1 filled | #e0e6ee empty>;`; link `font-family:'JetBrains Mono'; font-size:10.5px; color:#0e96d1; width:70px; text-align:right;`.
  - Right "Flags, both directions" (col gap:8px). **FlagRow** `display:flex; gap:9px; align-items:flex-start;`: kind tag `font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:<fg>; background:<bg>; border-radius:4px; padding:3px 7px; flex:none;`; text `font-size:12.5px; line-height:1.5; color:#38424b;`. Green flag: bg `#dcefe0`, fg `#0d4b17`. Worth probing: bg `#fdf6e3`, fg `#654a00`.
- Follow-ups: `border-top:1px solid #e9ebf8; padding-top:14px; display:flex; flex-direction:column; gap:8px;` — label "Suggested follow-ups for your loop · we are your first round, not your replacement" (muted uppercase). Each row `display:flex; gap:9px; align-items:flex-start;`: message-square SVG 14×14 (stroke #6940c9, width 2, `margin-top:2px`) + text `font-size:13px; line-height:1.5; color:#1e1e1e;`.

**Evidence tab** (`container gap:10px`): **EvidenceStoryCard** `border:1px solid #e9ebf8; border-radius:10px; padding:14px 16px; display:flex; flex-direction:column; gap:6px;` — header row `display:flex; align-items:center; justify-content:space-between; gap:10px;` (title `font-size:13.5px; font-weight:600;` + provenance tag `font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:<pfg>; background:<pbg>; border:1px solid <pbd>; border-radius:4px; padding:3px 7px; flex:none;`) + description `font-size:12.5px; line-height:1.55; color:#4a5662;`. Verified: pfg `#0a6b94`, pbg `#e7f5fa`, pbd `#90cfea`. Pending: pfg `#654a00`, pbg `#fdf6e3`, pbd `#e8b13a`. Footer note `font-size:11.5px; color:#869db3;`.

**Screen tab** — CANONICAL AUDIO PLAYER (option 2a) — see the dedicated section below.

**Logistics tab** (`container gap:0`): **LogisticsRow** `display:grid; grid-template-columns:170px 1fr; gap:14px; padding:12px 2px; border-bottom:1px solid #f0f3f9;` — key `font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:#869db3; padding-top:2px;` + value `font-size:13px; line-height:1.5; color:#1e1e1e;`.

**Non-June scope note** (`dNotJune`): container `padding:20px 24px 26px; display:flex; flex-direction:column; gap:12px;`. Rationale panel same as Summary but eyebrow reads "The Recruiter's rationale" and body is just `dCand.why` (no appended sentence). Then dashed note box `border:1px dashed #aebdcc; border-radius:10px; padding:12px 16px;` with `font-size:12.5px; line-height:1.55; color:#5f6f7f;` copy (verbatim in Copy section).

### Toast
`position:fixed; bottom:28px; left:50%; transform:translateX(-50%); background:#1e1e1e; color:#fff; border-radius:100px; padding:12px 22px; font-size:13px; font-weight:500; box-shadow:0 8px 24px rgba(30,30,30,.25); z-index:99; animation:slfade 200ms cubic-bezier(.2,0,0,1);`.

---

## The canonical audio player (Screen tab)

This is the load-bearing "option 2a" player. Reproduce geometry and behavior exactly.

**Player card**: `background:#fff; border:1px solid #e9ebf8; border-radius:14px; padding:18px 20px; display:flex; flex-direction:column; gap:12px; box-shadow:0 1px 2px rgba(30,30,30,.05);`.

1. **Top row** `display:flex; align-items:center; gap:14px;`:
   - **Play/pause button**: `width:46px; height:46px; border-radius:50%; border:none; background:#063f58; color:#fff; cursor:pointer; flex:none;` flex-centered. When playing → pause glyph SVG 15×15 (fill #fff): `<rect x="5" y="4" width="4.5" height="16" rx="1.5"/><rect x="14.5" y="4" width="4.5" height="16" rx="1.5"/>`. When paused → play glyph SVG 16×16 (fill #fff): `<path d="M7 4.5v15l13-7.5z"/>`.
   - Text col `flex:1; gap:2px;`: tag `font-size:14px; font-weight:600; color:#1e1e1e;` (= selected clip `tag`); caption "minute \<at\> · streamed, never downloadable · every play lands in the student's ledger" `font-size:11.5px; color:#869db3;`.
   - Time readout `font-family:'JetBrains Mono'; font-size:12px; color:#869db3; flex:none;` = "\<posLabel\> / \<durLabel\>".
2. **Waveform** `display:flex; align-items:flex-end; gap:2px; height:30px;` — **42 bars**, each `flex:1; height:<h>px; border-radius:2px; background:rgba(14,150,209,.45); transform-origin:bottom; animation:slpulse 800ms ease-in-out infinite; animation-delay:<d>ms; animation-play-state:<barPlay>;`. Bar generator (index i, 0..41): `h = 6 + ((i*37) % 22)`, `d = (i*97) % 500`. `barPlay = 'running'` while `playing`, else `'paused'`. `@keyframes slpulse { 0%,100% { transform:scaleY(.35);} 50% { transform:scaleY(1);} }` — bars only animate while playing; paused they freeze mid-scale.
3. **Progress track** `height:5px; border-radius:100px; background:#e9ebf8; overflow:hidden;` → fill `height:100%; background:#0e96d1; width:<pct>; transition:width 90ms linear;` (pct = `(frac*100)+'%'`).
4. **Synced transcript** `font-size:14px; line-height:1.75; padding-top:2px;` — each word is a `<span style="color:<c>; font-weight:<wt>; transition:color 120ms;">word&nbsp;</span>`. Word i of N flips to spoken style when `frac > 0 && i/N <= frac`: spoken = `color:#1e1e1e; font-weight:600`; unspoken = `color:#aebdcc; font-weight:400`. Words are the clip's `words` string split on spaces; each rendered with a trailing space.
5. **Rep's note row** `border-top:1px solid #e9ebf8; padding-top:10px; display:flex; gap:8px; align-items:flex-start;` — tag "Rep's note" `font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:#0a6b94; background:#e7f5fa; border-radius:4px; padding:3px 7px; flex:none;` + note text `font-size:12.5px; line-height:1.5; color:#4a5662;` (= clip `note`).

**Clip list** (below card) `display:flex; flex-direction:column; gap:8px;`. **ClipRow** button `display:flex; align-items:center; gap:12px; text-align:left; background:<rowBg>; border:1px solid <rowBd>; border-radius:10px; padding:11px 14px; cursor:pointer; font-family:Inter;` hover `border-color:#0e96d1`. Selected: `rowBg #f8fafc; rowBd #90cfea`. Unselected: `rowBg #fff; rowBd #e9ebf8`. Contents: at `font-family:'JetBrains Mono'; font-size:11px; color:#0e96d1; flex:none;`; tag `font-size:13px; font-weight:600; color:#1e1e1e; flex:1;`; duration "0:0\<dur\>" `font-size:11px; color:#869db3;`.

**Playback mechanics** (exact):
- `selClip` defaults to `'c1'` (state field not in the initial object; read as `s.selClip || 'c1'`).
- `posLabel = '0:0' + Math.floor(playing ? playT : 0)`; `durLabel = '0:0' + dur`. (Single-digit formatting only — safe because durs are 8/7/6. When paused, posLabel is "0:00".)
- `frac = playing_this_clip ? min(1, playT/dur) : 0`. If the selected clip is not the currently playing clip, frac is 0 (waveform paused, transcript all-unspoken, progress 0%).
- Play button `toggle()`: `setState({ playing: on ? null : c.id, playT: 0 })` — **toggling always resets playT to 0**, so pressing play (or re-pressing) restarts the clip from the beginning.
- Selecting a different clip (`ClipRow.pick`): `setState({ selClip: id, playing: null, playT: 0 })` — switching clips stops playback and resets position.
- **Global 100ms tick** (`componentDidMount`): `setInterval(..., 100)`. If `playing`, find the clip; `nt = playT + 0.1`; if `nt >= clip.dur` → `setState({ playing:null, playT:0 })` (auto-stop at end, snaps back to 0); else `setState({ playT: nt })`. Cleared on unmount. In React: a `useEffect` interval keyed to `playing`, or a single always-on interval reading a ref.

---

## Interactions & state machine

### Client state (from `state = {...}` and derived reads)
```
view:        'dashboard' | 'roles' | 'shortlist'          // default 'dashboard'
dossier:     candidateId | null                            // default null
dossierTab:  'summary' | 'evidence' | 'screen' | 'logistics' // default 'summary'
statuses:    { [candidateId]: 'none'|'intro'|'passed'|'saved' } // default {}
passOpen:    candidateId | null                            // which card's reason row is open
passReason:  null                                          // DECLARED BUT UNUSED — dead state, omit
intakeStep:  0 | 1 | 2 | 3                                 // default 0
playing:     clipId | null                                 // default null
playT:       number (seconds, +0.1/tick)                   // default 0
selClip:     clipId                                        // NOT in initial state; defaults to 'c1'
toast:       string | null                                 // default null
```
Instance (non-render) fields: `this.tick` (100ms interval id), `this.tt` (toast timeout id).

### Event handlers / transitions
- **Nav row (active item)**: `setState({ view: n.id, dossier: null })`. **Nav row (P2 stub)**: `pop(n.label + ' ships in phase 2. The Concierge can answer most of it today.')` — does NOT change view.
- **Ask the Concierge (header)** `pingConcierge`: `pop('Concierge: I can answer pool questions, rerun shortlists, or take a new role. Try me from any screen.')`.
- **Post a role** / roleRow "View intake"/"Resume intake" / shortlist "View intake": `goRoles` = `setState({ view:'roles' })`.
- **roleRow "Review shortlist"** / **goShortlist**: `setState({ view:'shortlist', dossier:null })`.
- **Dashboard concierge chip** (all 3): `pop('Concierge is on it. Reads are instant; anything that commits the platform gets drafted for operator approval.')`.
- **Intake Send** (`intakeReply`): `setState({ intakeStep: Math.min(2, intakeStep+1) })`.
- **Intake Confirm** (`intakeConfirm`, only at step 2): `setState({ intakeStep: 3 })` then `pop('Confirmed. Shortlist due Friday 4:12 PM. The Recruiter starts now.')`.
- **Shortlist Recalibrate + rerun** (`recal`): `pop('Concierge: tell me what to change ("more storage depth", "closer to Kirkland") and I rerun within the same SLA.')`.
- **Candidate name / "Open dossier →"** (`open`): `setState({ dossier: c.id, dossierTab:'summary', playing:null, playT:0 })`.
- **Request intro** (`intro`): `setState({ statuses:{...statuses, [id]:'intro'} })` then toast — anon: `'Consent to reveal requested. They choose first; you hear back within 48h.'`; else `'Intro requested. ' + firstName + ' picks from your interview slots tonight.'` (firstName = `name.split(' ')[0]`).
- **Pass** (`passO`): toggles the inline reason row — `setState({ passOpen: passOpen===id ? null : id })`. No status change yet.
- **Reason pick** (any of 4): `setState({ statuses:{...statuses, [id]:'passed'}, passOpen:null })` then `pop('Passed with a reason. Reasons tune your bar for the next run.')`. Card opacity drops to `.45`.
- **Save** (`saveC`): `setState({ statuses:{...statuses, [id]:'saved'} })` then `pop('Saved for later. Saved candidates surface again on your next role.')`.
- **Dossier tab click**: `setState({ dossierTab: t })`.
- **Play/pause** and **clip select**: see player mechanics above.
- **Close dossier** (X button OR overlay backdrop click): `setState({ dossier:null, playing:null })`. Modal body click calls `e.stopPropagation()` so inner clicks do not close.

### Intake conversation state machine
`intakeMsgs` is a fixed 6-message array, sliced by step: `slice(0, step>=2 ? 6 : step===1 ? 4 : 2)`.

| step | messages shown | composer control | Trainable row | Calibration row | SLA line + color |
|---|---|---|---|---|---|
| 0 | msgs 1–2 | Reply (ghost = "Trainable. Do not filter on it.") | "Open question: Kubernetes" (amber dot) | "Open question: what does great look like?" (amber) | "The 72-hour SLA starts when you confirm" (#869db3) |
| 1 | msgs 1–4 | Reply (ghost = "She prototyped fast but proved things. Wrote a repro before claiming any fix.") | "Kubernetes (moved from must-have on your answer)" (green dot) | still open (amber) | same (#869db3) |
| 2 | msgs 1–6 | **Confirm pill** "Confirm requirements, start the 72h clock" | resolved (green) | "Verification instinct + autonomy, weighted up" (green) | same (#869db3) |
| 3 | msgs 1–6 | Done banner "Confirmed. The Recruiter is matching; you will be pinged, not polled." | resolved | resolved | "72h clock running · shortlist due Fri 4:12 PM" (#0d4b17) |

Send at step 0 → step 1; Send at step 1 → step 2 (capped by `Math.min(2, …)`). Confirm at step 2 → step 3 + toast. Steps are one-way in the prototype (no back). Note the ghost input is display-only — it always shows the pre-scripted reply, it is not an editable field.

### Timers / animation
- **Toast**: shown by `pop(msg)`, cleared after **3000ms** (`setTimeout`), and any new toast clears the prior timeout so only one shows at a time. (README says ~2.8s; code is 3000ms — use 3000.)
- **Playback tick**: 100ms interval, advances `playT` by 0.1s, auto-stops at clip `dur`.
- **Waveform**: `slpulse` 800ms `ease-in-out` infinite, per-bar `animation-delay`, `animation-play-state` toggled by `playing`.
- **View / message / modal entrance**: `slfade` — view 240ms, intake message 220ms, modal 220ms, toast 200ms, all `cubic-bezier(.2,0,0,1)`. `@keyframes slfade { from { transform:translateY(7px);} to { transform:none;} }` (rise only; despite the name there is no opacity fade in the keyframe).
- **Card opacity** transition `180ms`; progress-bar width transition `90ms linear`; transcript word color transition `120ms`; name/button hovers are instant color/border changes (never scale or lift).

Production notes (from README): call timer, captions, audio playback, and the intake conversation are simulated here and must be driven by real ASR/interview state, presigned audio with real word timestamps, and the Concierge LLM. Pass always requires a reason; publishing/approval is the only path to sponsor visibility (that flow lives in the student app, not here).

---

## Copy, verbatim

**Header / chrome**
- "Hub"
- "ScottyLabs Talent"
- "Sponsor portal · Scogle, Inc · Premier"
- "License: internal recruiting use only · all access logged"
- "Ask the Concierge"

**Sidebar**
- Nav: "Dashboard", "Roles", "Shortlist", "Talent Search", "Pipeline", "API + MCP", "Analytics"
- P2 badge: "P2"
- "Role slots" / "3 / 10" / "Premier · renews Aug 2026"

**Dashboard**
- "Morning, Jordan"
- "Tuesday, July 1 · one shortlist waiting on you, one role matching, one intake open"
- "Post a role"
- Stat labels: "candidates screened for your roles", "time to first shortlist, SLA 72h", "intros accepted on role 1 so far", "role slots used this year"
- "Your roles" / "shortlist SLA: 72 hours from confirm"
- Role statuses: "Shortlist ready · 10 candidates, 1 wildcard"; "Recruiter matching · longlist of 27 in deep evaluation"; "Concierge is waiting on your calibration answer"
- Role SLA chips: "Delivered in 41h"; "38h left"; "SLA starts on confirm"
- Role actions: "Review shortlist"; "View intake"; "Resume intake"
- "Concierge"
- "reads anything you are licensed to see · commitments get drafted for a human"
- Chips: "How many ML systems students graduate in May?"; "Rerun role 1, weight Go higher"; "Which shortlisted candidates are alumni?"

**Role intake**
- "Role intake"
- "A conversation, not a form. Paste a JD or just talk; the Concierge extracts the structured role and asks only what matters."
- "SWE Intern, Infrastructure · intake thread"
- Message 1 (Jordan @ Scogle): "New role. Pasting the JD for a storage-adjacent SWE intern, Summer 2027, Pittsburgh or Kirkland."
- Message 2 (Concierge): "Read it. My extraction: SWE Intern on distributed storage, Summer 2027, Pittsburgh or Kirkland, $54/hr, posted to candidates as required. Must-haves: systems fundamentals, one distributed project with real failure handling, Go or C++. Nice-to-have: storage internals. Two questions before I match. First: Kubernetes, must-have or trainable?"
- Message 3 (Jordan @ Scogle): "Trainable. Do not filter on it."
- Message 4 (Concierge): "Moved to trainable. Second: think of your best recent intern. What made them great?"
- Message 5 (Jordan @ Scogle): "She prototyped fast but proved things. Wrote a repro before claiming any fix. Did not need hand-holding."
- Message 6 (Concierge): "That reads as verification instinct plus autonomy, both weighted up within role-relevant criteria. The summary on the right is final. Confirm it and your 72-hour clock starts."
- Send button: "Send"
- Confirm button: "Confirm requirements, start the 72h clock"
- Done banner: "Confirmed. The Recruiter is matching; you will be pinged, not polled."
- Summary header: "The role, as the platform understands it"
- Summary keys: "Role", "Logistics", "Must-have", "Trainable", "Calibration", "Refused"
- Summary values: "SWE Intern, Infrastructure (storage replication)"; "Summer 2027 · Pittsburgh or Kirkland · $54/hr, disclosed to candidates"; "Systems fundamentals · distributed project with failure handling · Go or C++"; "Open question: Kubernetes" → "Kubernetes (moved from must-have on your answer)"; "Open question: what does great look like?" → "Verification instinct + autonomy, weighted up"; "Filters that proxy protected classes are declined at intake, by policy"
- SLA line: "The 72-hour SLA starts when you confirm" → "72h clock running · shortlist due Fri 4:12 PM"

**Shortlist**
- Eyebrow: "Shortlist · delivered in 41h of the 72h SLA"
- Title: "SWE Intern, Infrastructure"
- Funnel: "62 screened, 27 deep-evaluated, 9 answered your follow-up question. Eight archetype fits, one alum, one wildcard: composition is policy, and every rank explains itself."
- Buttons: "Recalibrate + rerun"; "View intake"
- Badges: "Wildcard slot"; "Alum"; "Match-only"
- Chip prefix "fit" (rendered as "fit 94" etc.)
- Card actions: "Request intro"; "Pass"; "Save"; "Open dossier →"
- Status chips: "Intro requested ✓"; "Passed"; "Saved"
- Pass-reason label: "Why pass? Feeds calibration:"
- Pass reasons: "Too junior for this req"; "Missing a must-have"; "Overlaps an existing hire"; "Other"
- Footer: "When fewer than ten clear the bar, you get fewer than ten with a note. Padding is how trust dies, so we do not."

**DossierView**
- "SSO verified"
- Meta pattern: "\<meta\> · rank \<rank\> of 10 · fit \<score\>"
- Tabs: "Summary"; "Evidence"; "Screen"; "Logistics"
- Summary eyebrow (June): "Why ranked 1 · the Recruiter's rationale"
- Summary body suffix (June, appended to why): " Ratings below link to the exact minute of evidence; nothing here is unexplainable."
- "Competency, rated on the public rubric"
- "Flags, both directions"
- Flag tags: "Green flag"; "Worth probing"
- "Suggested follow-ups for your loop · we are your first round, not your replacement"
- Evidence provenance note: "Provenance is shown honestly everywhere: verified, self-reported, or pending. Pending means the Verifier is still cross-checking; it is not a penalty."
- Provenance tags: "Verified"; "Pending"
- Player caption: "minute \<at\> · streamed, never downloadable · every play lands in the student's ledger"
- "Rep's note"
- Non-June eyebrow: "The Recruiter's rationale"
- Non-June scope note: "This prototype builds the complete dossier for June Park, rank 1. Open hers for the full Summary, Evidence, Screen and Logistics experience; every candidate gets the same structure in production."

**Toasts** (exact strings)
- "\<label\> ships in phase 2. The Concierge can answer most of it today." (P2 nav)
- "Concierge: I can answer pool questions, rerun shortlists, or take a new role. Try me from any screen." (header)
- "Concierge is on it. Reads are instant; anything that commits the platform gets drafted for operator approval." (dashboard chips)
- "Confirmed. Shortlist due Friday 4:12 PM. The Recruiter starts now." (intake confirm)
- "Concierge: tell me what to change (\"more storage depth\", \"closer to Kirkland\") and I rerun within the same SLA." (recalibrate)
- "Intro requested. \<FirstName\> picks from your interview slots tonight." (intro, named candidate)
- "Consent to reveal requested. They choose first; you hear back within 48h." (intro, match-only)
- "Passed with a reason. Reasons tune your bar for the next run." (pass reason)
- "Saved for later. Saved candidates surface again on your next role." (save)

---

## Demo / seed data

### Sponsor / account
- Operator name: "Jordan" (avatar letter "J"); company "Scogle, Inc"; tier "Premier"; sender label in intake "Jordan @ Scogle".
- Role slots: 3 of 10 used (30% fill). Renews Aug 2026.

### Dashboard stats (`stats`)
| n | label |
|---|---|
| 62 | candidates screened for your roles |
| 41h | time to first shortlist, SLA 72h |
| 4 / 10 | intros accepted on role 1 so far |
| 3 / 10 | role slots used this year |

### Roles table (`roleRows`)
| name | meta | status | sla | slaBg / slaFg | action |
|---|---|---|---|---|---|
| SWE Intern, Infrastructure | Posted Jun 26 · storage replication team | Shortlist ready · 10 candidates, 1 wildcard | Delivered in 41h | #dcefe0 / #0d4b17 | Review shortlist → shortlist |
| PM Intern, Developer Products | Posted Jun 30 · confirmed yesterday | Recruiter matching · longlist of 27 in deep evaluation | 38h left | #fdf6e3 / #654a00 | View intake → roles |
| Research Intern, Efficient Inference | Draft · one intake question open | Concierge is waiting on your calibration answer | SLA starts on confirm | #f0f4f8 / #5f6f7f | Resume intake → roles |

### Concierge suggestion chips (`conciergeChips`)
"How many ML systems students graduate in May?", "Rerun role 1, weight Go higher", "Which shortlisted candidates are alumni?" (all fire the same drafted-for-approval toast).

### Intake requirements summary (`intakeSummary`) — see state-machine table for step-dependent values
Static rows: Role, Logistics, Must-have, Refused (all `ok:true`, green dot). Dynamic rows: Trainable and Calibration (amber dot / open until their step). Refused row is the standing policy row: "Filters that proxy protected classes are declined at intake, by policy".

### Candidates (`candidatesDef`) — the ten-person shortlist for "SWE Intern, Infrastructure"
Common fields: `avBg` = #063f58 (or #c7d2dc for anon), name button, badge by kind, two-sentence `why`, three `chips`, `score`. Only p1 (June Park) has full dossier content.

**p1 · rank 1 · June Park · "JP" · fit 94 · kind: full**
- meta: "SCS · BS CS · May 2027 · F-1, CPT eligible"
- why: "Strongest evidence-to-claim ratio in the pool for this role. Verified Raft consensus work under injected partitions maps directly onto your storage replication team."
- chips: "15-440 consensus, verified" · "railtrace, Go, 18k lines" · "Screen: 3 strong moments"

**p2 · rank 2 · Rohan Mehta · "RM" · fit 91 · kind: full**
- meta: "ECE · BS ECE · Dec 2026"
- why: "Shipped a production eBPF profiler during an internship and can defend every tradeoff in it. Deepest systems fundamentals of the slate."
- chips: "18-613, verified" · "eBPF profiler, verified" · "Screen: precise, terse"

**p3 · rank 3 · Amara Diallo · "AD" · fit 90 · kind: full**
- meta: "SCS · BS CS · May 2026"
- why: "TA for 15-445 and built a B+ tree storage engine that beat the course baseline threefold. Asked for storage work specifically, which your JD rewards."
- chips: "15-445 TA, verified" · "Storage engine, verified" · "Asked for this domain"

**p4 · rank 4 · Sasha Volkov · "SV" · fit 88 · kind: alum** (badge "Alum")
- meta: "Alum · MS CS 2025 · no sponsorship needed"
- why: "One year at a seed-stage infra startup that folded; owned their Kafka-to-Iceberg pipeline end to end. Alumni are in scope this year and the evidence is fresh."
- chips: "Alum, verified" · "Pipeline repo, verified" · "Screen: strong ownership"

**p5 · rank 5 · Grace Liu · "GL" · fit 86 · kind: full**
- meta: "SCS · BS CS + Robotics · May 2027"
- why: "Distributed fleet simulation for 200 robots with deterministic replay. Communication rated highest of the slate."
- chips: "Fleet sim, verified" · "15-440, verified" · "Screen: best communicator"

**p6 · rank 6 · Daniel Kovács · "DK" · fit 84 · kind: full**
- meta: "MCS · BS CS · May 2027"
- why: "Two merged upstream PRs in the etcd lease subsystem. Interview depth was real but narrower than the top three."
- chips: "etcd PRs, verified" · "Go, verified" · "Screen: deep but narrow"

**p7 · rank 7 · Match-only candidate · "·" · fit 83 · kind: anon** (badge "Match-only", avatar #c7d2dc)
- meta: "SCS masters · May 2027 · consent requested Mon"
- why: "Match-only visibility: identity reveals if they consent to this shortlist. Evidence summary shown; profile is complete and verified underneath."
- chips: "Consensus research, verified" · "Screen completed" · "Awaiting reveal consent"

**p8 · rank 8 · Priyanka Nair · "PN" · fit 82 · kind: full**
- meta: "ECE · BS ECE · May 2027"
- why: "FPGA-accelerated key-value cache as an independent study, measured end to end. Hardware-adjacent depth your team said it lacks."
- chips: "FPGA KV cache, verified" · "18-447, verified" · "Screen: methodical"

**p9 · rank 9 · Ben Okonkwo · "BO" · fit 78 · kind: wild** (badge "Wildcard slot")
- meta: "Dietrich · Stat + ML · May 2028"
- why: "The wildcard slot, stated policy. Thin resume, outsized evidence: runs his own Raft implementation on a 6-node homelab, with documented failure drills."
- chips: "Homelab Raft, verified" · "TartanHacks finalist" · "Sophomore, high slope"

**p10 · rank 10 · Tomás Rivera · "TR" · fit 77 · kind: full**
- meta: "SCS · BS CS · Dec 2027"
- why: "Solid systems coursework and a clean screen. Evidence is course-scoped so far; ranked above two higher raw scores on freshness and stated role interest."
- chips: "15-213 + 15-440, verified" · "Screen: solid" · "Freshness: 2 days"

### June Park dossier content

**Competency matrix** (`competency`, 5-dot scale, filled #0e96d1 / empty #e0e6ee):
| competency | dots | link |
|---|---|---|
| Technical depth | 5/5 (1,1,1,1,1) | 14:42 |
| Verification instinct | 5/5 (1,1,1,1,1) | 17:03 |
| Ownership clarity | 4/5 (1,1,1,1,0) | 21:48 |
| Communication | 4/5 (1,1,1,1,0) | transcript |

**Flags** (`dFlags`):
- Green flag — "Gave a precise failure analysis unprompted, minute 14:42." (bg #dcefe0, fg #0d4b17)
- Green flag — "Proves fixes with replays, not reruns. Minute 17:03." (bg #dcefe0, fg #0d4b17)
- Worth probing — "Early answers said \"we\" on RailTrace; resolved cleanly when probed at 21:48." (bg #fdf6e3, fg #654a00)

**Follow-ups** (`dFollowups`):
- "How would she shard the replay checker if the fleet were 40,000 units instead of one rail line?"
- "What would she cut from RailTrace to ship it in two weeks instead of a weekend?"

**Evidence stories** (`dStories`):
| title | description | provenance |
|---|---|---|
| RailTrace · TartanHacks 2026, 1st of 63 | Ingestion + dead-reckoning for Pittsburgh light rail. Solo on the pipeline; 1,400 weekly riders in demo month. | Verified |
| Backend intern · Meridian Robotics | Store-and-forward telemetry buffer with idempotent replay; client library adopted by two other teams. | Pending |
| Consensus under partition · 15-440 | Election + persistence modules, about 1,100 lines. Survived all 500 adversarial partition schedules. | Verified |

**Logistics** (`dLogistics`):
| key | value |
|---|---|
| Graduation | May 2027 · BS Computer Science, SCS |
| Looking for | Internships and new grad · open to startups |
| Locations | Pittsburgh or SF Bay. Kirkland not listed; flagged for your intro call. |
| Work authorization | F-1, CPT eligible. Self-declared, shown exactly as entered. |
| Freshness | Profile refreshed 3 days ago · screen completed Jul 1 |

**Screen clips** (`clipsFor`) — the audio highlights:
| id | tag | at (minute) | dur (s) | rep's note | transcript words |
|---|---|---|---|---|---|
| c1 | Debugging under pressure | 14:42 | 8 | Unprompted, complete failure analysis: symptom, hypothesis, evidence, fix, proof. The strongest 40 seconds of the screen. | "Our Raft implementation kept electing two leaders under partition. The real bug was that we persisted votedFor after the term check, not atomically with it. I rewrote the vote record as a single fsync tuple." |
| c2 | Verification instinct | 17:03 | 7 | Did not stop at "it works". Built a replay checker to prove the fix. Rare at intern level. | "Then I added a Jepsen style checker that replayed the exact partition schedule five hundred times. Zero split votes after the fix, across every schedule." |
| c3 | Ownership clarity | 21:48 | 6 | Clean answer to the individual-contribution probe. Numbers offered without prompting. | "The election module and the persistence layer were mine, about eleven hundred lines. My partner owned log replication, and we co-wrote the test harness." |

Clip durations render as "0:08", "0:07", "0:06"; positions during playback as "0:00".."0:0N".

---

## SVG & iconography

All icons are Lucide-style: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"` (unless noted), `stroke-linecap="round"`, `stroke-linejoin="round"`. Production uses `lucide-react`.

| Where | Size | stroke-width | Path(s) | Lucide name |
|---|---|---|---|---|
| Hub back link | 14×14 | 2 | `M19 12H5` / `m12 19-7-7 7-7` | `ArrowLeft` |
| Ask Concierge; Summary follow-ups | 13×13; 14×14 | 2 | `M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z` | `MessageSquare` (follow-up stroke `#6940c9`) |
| Nav: Dashboard | 17×17 | 1.75 | `M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z` | `LayoutDashboard` |
| Nav: Roles | 17×17 | 1.75 | `M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z` | `Briefcase` |
| Nav: Shortlist | 17×17 | 1.75 | `M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01` | `List` |
| Nav: Talent Search | 17×17 | 1.75 | `M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35` | `Search` |
| Nav: Pipeline | 17×17 | 1.75 | `M22 12h-4l-3 9L9 3l-3 9H2` | `Activity` |
| Nav: API + MCP | 17×17 | 1.75 | `m16 18 6-6-6-6M8 6l-6 6 6 6` | `Code` |
| Nav: Analytics | 17×17 | 1.75 | `M3 3v18h18M7 14l4-4 3 3 5-6` | `LineChart` |
| Intake done banner | 14×14 | 2.4 | `M20 6 9 17l-5-5` (stroke `#0d4b17`) | `Check` |
| Intake SLA row | 15×15 | 2 | `<circle cx="12" cy="12" r="9"/>` + `M12 7v5l3 3` (stroke = slaColor) | `Clock` |
| Dossier close | 15×15 | 2 | `M18 6 6 18M6 6l12 12` (stroke `#4a5662`) | `X` |
| Player play | 16×16 | — | `<path d="M7 4.5v15l13-7.5z"/>` (`fill:#fff`) | `Play` (custom filled triangle) |
| Player pause | 15×15 | — | `<rect x="5" y="4" width="4.5" height="16" rx="1.5"/><rect x="14.5" y="4" width="4.5" height="16" rx="1.5"/>` (`fill:#fff`) | `Pause` (custom) |

**Brand glyph tile** (header 34px, Concierge card 30px): the tile background is `conic-gradient(from 180deg at 50% 50%, #d72444 0%, #8766d4 25%, #0e96d1 55%, #063f58 80%, #d72444 100%)`; header tile adds `box-shadow:inset 0 -5px 12px rgba(0,0,0,.25)`. Inside is the white Scotty monogram, a custom SVG `viewBox="0 0 64 55" fill="#fff"` (18×16 in header, 15×13 in Concierge card). Full path:
```
M 3.251 55 L 0 55 C 0 49.426 1.006 44.008 2.98 38.94 C 3.754 36.991 4.644 35.12 5.689 33.288 L 6.114 32.548 L 6.966 32.47 C 8.63 32.353 11.261 32.002 14.241 30.911 C 18.575 29.352 22.096 26.857 24.728 23.505 C 26.779 20.893 28.21 17.892 28.984 14.539 L 25.502 2.222 L 28.791 0 L 29.72 0.702 C 31.848 2.3 34.092 3.82 36.414 5.106 C 37.885 5.964 39.433 6.743 40.98 7.445 C 43.96 7.328 46.979 7.016 49.92 6.588 C 53.596 6.042 57.272 5.301 60.871 4.327 L 62.341 3.937 L 62.844 5.418 C 63.735 8.147 64.122 10.953 63.967 13.799 C 63.851 16.488 63.231 19.1 62.187 21.556 L 59.207 20.269 C 60.097 18.164 60.6 15.904 60.716 13.604 C 60.832 11.694 60.639 9.784 60.174 7.913 C 56.962 8.731 53.673 9.394 50.384 9.862 C 47.211 10.33 43.96 10.602 40.71 10.758 L 40.323 10.758 L 39.974 10.602 C 38.233 9.784 36.492 8.926 34.789 7.952 C 33.009 6.938 31.229 5.808 29.526 4.6 L 32.39 14.461 L 32.312 14.851 C 31.422 18.866 29.758 22.452 27.32 25.532 C 24.302 29.391 20.277 32.197 15.363 33.99 C 12.499 35.004 9.945 35.471 8.088 35.666 C 7.314 37.108 6.617 38.629 5.998 40.149 C 4.179 44.826 3.251 49.816 3.251 55 Z
```
Ship this as `assets/scottylabs-monogram.svg` and render inline (white) inside the gradient tile.

**Waveform bars**: not SVG — 42 `<span>` elements, geometry generated in JS (see player section). **Competency dots** and **status dots** are plain CSS circles, not icons.

---

## Accessibility & floors

From the handoff:
- **Type floors**: sponsor tables 12px minimum, tap targets 44px. Body copy floors at 12.5px on student app; the portal uses 11–12px on tags/captions which is acceptable for the desktop surface but keep body/table text ≥12px.
- **Contrast / provenance**: provenance grammar is identical everywhere and never shamed — verified = solid border + blue tint, self-reported = dashed hollow, pending = amber, audio moment = purple edge, missing = dashed gray reduced opacity. Do not restyle provenance to imply penalty (the copy explicitly says "Pending … is not a penalty").
- **Tap-target caveat to flag**: many controls here are shorter than the 44px floor — sidebar nav rows are ~37px, card action pills 34px, pass-reason chips 28px, dossier tabs 32px. On a mouse-first desktop portal this matches the prototype, but reconcile with the 44px guideline for touch / accessibility review (out-of-scope per README, but note it).
- **Motion**: 120–280ms, `cubic-bezier(.2,0,0,1)`; hover darkens, never scales/lifts. Provide a reduced-motion variant for `slpulse` (waveform), `slfade`, and the 100ms playback tick (README lists reduced-motion as a pending pass).
- **Modal focus**: not implemented in the prototype. Add focus trap, `Escape`-to-close, `role="dialog"`/`aria-modal`, and return focus to the invoking candidate button. Backdrop click closes; ensure keyboard parity.
- **Player**: the transcript word-flip is decorative color; keep the full transcript readable regardless of playback. Audio is stream-only, "never downloadable"; every play is logged to the student ledger (production behavior).
- **Not designed (do not improvise; flag for design)**: empty/loading/error states for all views, responsive below 1100px, match-only consent-reveal flow (only the card state exists), the stubbed P2 nav destinations.

---

## Implementation cautions (simulated-only / decisions to make)

- `passReason` is declared in initial state but never read — omit it.
- `selClip` is read as `s.selClip || 'c1'` but is not in the initial `state` object — initialize it to `'c1'`.
- Toast duration is **3000ms** in code (README says ~2.8s); pick one and standardize.
- The tartan recipe on the shortlist header and dossier spine (6/30/32/60 + 2.5/8) differs from the README's canonical token (5/26/28/52 + 2/7). Prototype fidelity = use the values in this file; if you tokenize tartan globally, decide which is source of truth.
- `slfade` keyframe only translates (no opacity); README describes "fade+rise." If you want a true fade, add `opacity` to the keyframe deliberately.
- Intake is one-way (no step-back), the ghost composer input is non-editable display text, and all Concierge/sponsor turns are hard-scripted. Production replaces this with the Concierge LLM + real requirement extraction.
- Only June Park (`p1`) has full dossier data; every other candidate shows rationale + the scope note. Production must supply full Summary/Evidence/Screen/Logistics for all candidates.
- The header "Hub" link and cross-file navigation are prototype plumbing; wire to real routes or remove.
