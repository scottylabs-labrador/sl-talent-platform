# Ops Console — Implementation Spec

Source prototype: `design_files/Ops Console.dc.html`
Target: React + TypeScript, Next.js App Router. Fidelity target: pixel-perfect.

This is the internal ops surface: volunteers resolve an **exception queue** while agents run
everything else. It is a single-view, single-screen application (no client-side routing). All
interactivity lives in one component: resolving queue items and firing a toast. There is a sticky
right sidebar with weekly stats, an agent-workforce health list, and an adverse-impact monitor.

Everything below is extracted verbatim from the prototype's inline styles and `<script>`. Where the
handoff README and the HTML disagree, the HTML wins for pixel values and the disagreement is called
out inline. Ignore `support.js`, `<x-dc>`, and `<helmet>` — prototype plumbing only.

---

## Screen inventory

The Ops Console is **one screen** with no navigation between screens. There is one outbound link
(back to the Hub) that exists in the prototype only. All state changes are in-place mutations of the
same screen. The distinct visual states are:

1. **Queue populated (default / initial).** Six open exception cards stacked in the left column,
   sticky sidebar on the right. `openCount = 6`. This is the landing state.
2. **Partially resolved.** Any card the operator acts on collapses in place from a full open card to
   a one-line dashed "resolved row." The remaining open cards stay full. `openCount` in the subtitle
   decrements. Resolved rows remain visible in their original position in the list (they are not
   removed or reordered).
3. **Queue clear (empty state).** When all six items are resolved (`openCount === 0`,
   `allDone === true`), an additional dashed empty-state panel appears **below** the six resolved
   rows: "Queue clear. The agents have the rest. See you at the Monday digest." The resolved rows do
   not disappear; the empty-state panel is appended.
4. **Toast overlay (transient).** Any resolve action (approve / override / escalate) shows a
   bottom-center black pill toast for 2800 ms. One toast at a time; a new action replaces the current
   toast and resets the 2800 ms timer. This overlays whatever queue state is active.

There is **no** reset/undo path in the prototype: once resolved, an item stays resolved for the life
of the page. Re-acting on an already-resolved item is not possible (the buttons are gone once the
card collapses). Production must decide whether resolution is reversible (see Ambiguities).

### Navigation

- **Hub back link** (top-left of the dark header): `href="Talent Hub.dc.html"`. In production this
  routes to the hub/home surface. Prototype-only cross-linking per the handoff; wire to the real hub
  route.
- No other navigation. The adverse-impact card **mentions** the "Shortlist Sampler" in prose but is
  **not** a link in the prototype (phase-2, per handoff). Do not add a link unless product designs it.

---

## Component tree

The handoff README does not give ops-specific component names (it names student/sponsor components
like `PrimaryActionCard`, `StrengthMeter`, `CandidateCard`, `DossierView`, `AsyncQuestionCard` — none
of which appear here). Proposed breakdown, mapped to the DOM:

```
OpsConsolePage                     // route: app/ops/page.tsx (or equivalent)
├─ OpsHeader                       // <header> dark bar, 56px, sticky top:0
│  ├─ HubBackLink                  // arrow-left icon + "Hub"
│  ├─ HeaderDivider                // 1px vertical rule
│  ├─ OpsBrandTitle                // "Talent Ops"
│  ├─ InternalScopePill            // "internal · volunteers handle exceptions…"
│  └─ HeaderMeta                   // right-aligned group
│     ├─ DigestStamp               // "wk 27 · Mon digest sent 8:02 AM"
│     └─ OperatorAvatar            // 30px blue circle, "L"
│
└─ OpsBody                         // flex, max-width 1280, two columns
   ├─ ExceptionQueue               // left column, flex 1.7
   │  ├─ QueueHeader
   │  │  ├─ QueueTitle             // "Exception queue" + subtitle w/ {openCount}
   │  │  └─ MedianStamp            // "median this wk: 1.4 min"
   │  ├─ ExceptionCard ×N          // open state (one per unresolved item)
   │  │  ├─ CategoryTag            // colored pill, q.cat
   │  │  ├─ ExceptionTitle
   │  │  ├─ AgeStamp               // mono, q.age
   │  │  ├─ AgentContextBox
   │  │  │  ├─ AgentTag            // outlined tag, q.agent
   │  │  │  └─ ContextText         // q.context
   │  │  ├─ RecommendedLine        // wand icon + "Recommended: …"
   │  │  └─ ExceptionActions
   │  │     ├─ ApproveButton       // black pill "Approve recommended"
   │  │     ├─ OverrideButton      // outline pill "Override"
   │  │     └─ EscalateButton      // outline pill "Escalate to lead"
   │  ├─ ResolvedRow ×N            // collapsed dashed row (one per resolved item)
   │  └─ QueueEmptyState           // shown only when allDone
   │
   └─ OpsSidebar                   // right column, 320px, sticky top:82px
      ├─ WeekStatsCard
      │  └─ StatRow ×5             // label + colored mono value
      ├─ AgentWorkforceCard
      │  ├─ WorkforceHeader        // "Agent workforce" + "eval / autonomy"
      │  ├─ AgentRow ×6            // dot + name/note + eval + autonomy tag
      │  └─ WorkforceFootnote      // "Autonomy graduates on written criteria…"
      └─ AdverseImpactCard        // dark teal card
│
└─ Toast                          // fixed bottom-center pill, conditional
```

`ExceptionCard` and `ResolvedRow` are two render states of the same queue item keyed by `id`. Model
the queue as a list; each item renders `ExceptionCard` when open and `ResolvedRow` when resolved.

---

## Exact styles per component

Global: body `margin:0; background:#f0f4f8;`. Root wrapper `min-height:100vh;
font-family:Inter,ui-sans-serif,system-ui,sans-serif; color:#1e1e1e; display:flex;
flex-direction:column;`.

Fonts (load these three families; never fall back to system-ui for display/mono):
- **Satoshi** weights 400,500,700,900 (Fontshare). Used for display titles.
- **Inter** weights 400,500,600,700 (Google). Default UI font.
- **JetBrains Mono** weights 400,500,600 (Google). Timestamps, scores, ids, stamps.

### OpsHeader
- `height:56px; background:#1e1e1e; display:flex; align-items:center; gap:16px; padding:0 24px;
  position:sticky; top:0; z-index:50;`

**HubBackLink** (`<a href="Talent Hub.dc.html">`):
- `display:flex; align-items:center; gap:8px; text-decoration:none; color:#aebdcc;
  font-size:13px; font-weight:600;`
- Contains arrow-left SVG (14×14, `stroke:currentColor`, so it inherits `#aebdcc`) + text "Hub".
- No explicit hover state defined in source.

**HeaderDivider**: `<span>` `width:1px; height:20px; background:#4a5662;`

**OpsBrandTitle** ("Talent Ops"):
- `font-family:Satoshi,Inter,sans-serif; font-weight:700; font-size:15px;
  letter-spacing:-0.02em; color:#fff;`

**InternalScopePill** ("internal · volunteers handle exceptions, agents handle everything else"):
- `font-size:11px; color:#869db3; border:1px solid #4a5662; border-radius:100px; padding:4px 10px;`

**HeaderMeta** wrapper: `margin-left:auto; display:flex; align-items:center; gap:14px;`

**DigestStamp** ("wk 27 · Mon digest sent 8:02 AM"):
- `font-family:'JetBrains Mono',monospace; font-size:12px; color:#869db3;`

**OperatorAvatar** ("L"):
- `width:30px; height:30px; border-radius:50%; background:#0e96d1; color:#fff; display:flex;
  align-items:center; justify-content:center; font:600 12px Inter;`

### OpsBody
- `flex:1; display:flex; gap:20px; padding:26px 28px 56px; max-width:1280px; width:100%;
  margin:0 auto; box-sizing:border-box; align-items:flex-start;`

### ExceptionQueue (left column)
- Wrapper: `flex:1.7; min-width:0; display:flex; flex-direction:column; gap:14px;`

**QueueHeader** row: `display:flex; align-items:baseline; justify-content:space-between;`
- Left group: `display:flex; flex-direction:column; gap:3px;`
  - **QueueTitle**: `font-family:Satoshi,Inter,sans-serif; font-weight:700; font-size:24px;
    letter-spacing:-0.02em;` → text: "Exception queue"
  - **QueueSubtitle**: `font-size:12.5px; color:#5f6f7f;` → text:
    "{openCount} open · every item arrives with agent context and a recommended action · target
    median under 2 minutes" (`{openCount}` is live, starts at 6)
- **MedianStamp** (right): `font-family:'JetBrains Mono',monospace; font-size:12px; color:#5f6f7f;`
  → text: "median this wk: 1.4 min" (static)

**ExceptionCard** (open item):
- `background:#fff; border:1px solid #e9ebf8; border-radius:12px; padding:16px 20px;
  display:flex; flex-direction:column; gap:10px; box-shadow:0 1px 2px rgba(30,30,30,.04);
  animation:slfade 200ms cubic-bezier(.2,0,0,1);`
- **Title row**: `display:flex; align-items:center; gap:10px;`
  - **CategoryTag**: `font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
    color:{catFg}; background:{catBg}; border-radius:4px; padding:4px 8px; flex:none;` (colors per
    category, see Seed data)
  - **ExceptionTitle**: `font-size:14px; font-weight:600; flex:1;`
  - **AgeStamp**: `font-family:'JetBrains Mono',monospace; font-size:11px; color:#869db3; flex:none;`
- **AgentContextBox**: `display:flex; gap:9px; align-items:flex-start; background:#f8fafc;
  border:1px solid #e9ebf8; border-radius:8px; padding:10px 13px;`
  - **AgentTag**: `font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
    color:#5f6f7f; border:1px solid #c7d2dc; border-radius:4px; padding:2px 6px; flex:none;
    margin-top:1px;`
  - **ContextText**: `font-size:12.5px; line-height:1.55; color:#38424b;`
- **RecommendedLine**: `display:flex; align-items:center; gap:10px;`
  - Wand SVG 14×14, `stroke:#0a6b94`, `flex:none` (geometry in SVG section)
  - Text: `font-size:12.5px; line-height:1.5; color:#1e1e1e;` — markup is
    `<b>Recommended:</b> {rec}` (the word "Recommended:" is bold, the rec sentence is not)
- **ExceptionActions** row: `display:flex; gap:8px; padding-top:2px;`
  - **ApproveButton** ("Approve recommended"): `height:34px; padding:0 16px; border-radius:100px;
    border:none; background:#1e1e1e; color:#fff; font:600 12px Inter; cursor:pointer;`
    — **hover:** `background:#383838;`
  - **OverrideButton** ("Override"): `height:34px; padding:0 14px; border-radius:100px;
    border:1px solid #c7d2dc; background:#fff; font:600 12px Inter; color:#4a5662; cursor:pointer;`
    — **hover:** `border-color:#869db3;`
  - **EscalateButton** ("Escalate to lead"): identical to OverrideButton (same padding `0 14px`,
    same border, same hover `border-color:#869db3;`).

**ResolvedRow** (collapsed / resolved item):
- `border:1px dashed #c7d2dc; border-radius:12px; padding:11px 20px; display:flex;
  align-items:center; gap:10px; opacity:.75;`
- Check SVG 14×14, `stroke:#0d4b17`, `stroke-width:2.4`, `flex:none`
- Text: `font-size:12.5px; color:#4a5662;` — markup `<b>{resolvedAs}</b> · {title}` (resolvedAs bold)
- Trailing stamp: `font-family:'JetBrains Mono',monospace; font-size:11px; color:#869db3;
  margin-left:auto;` → text "logged → eval data" (literal, uses the → arrow character)

**QueueEmptyState** (only when `allDone`):
- `border:1px dashed #aebdcc; border-radius:12px; padding:22px; text-align:center;`
- Text: `font-size:13.5px; color:#4a5662;` → "Queue clear. The agents have the rest. See you at the
  Monday digest."

### OpsSidebar (right column)
- Wrapper: `width:320px; flex:none; display:flex; flex-direction:column; gap:14px;
  position:sticky; top:82px;`

**WeekStatsCard**:
- `background:#fff; border:1px solid #e9ebf8; border-radius:12px; padding:16px 18px;
  display:flex; flex-direction:column; gap:11px; box-shadow:0 1px 2px rgba(30,30,30,.04);`
- Header label: `font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  color:#869db3;` → "This week"
- **StatRow** (×5): `display:flex; align-items:baseline; justify-content:space-between; gap:10px;`
  - Label: `font-size:12.5px; color:#4a5662;`
  - Value: `font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:600; color:{w.c};`

**AgentWorkforceCard**:
- Same card box as WeekStatsCard but `gap:10px` (not 11px).
- **WorkforceHeader**: `display:flex; align-items:center; justify-content:space-between;`
  - Left label: `font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
    color:#869db3;` → "Agent workforce"
  - Right label: `font-size:10.5px; color:#869db3;` → "eval / autonomy"
- **AgentRow** (×6): `display:flex; align-items:center; gap:10px; padding:7px 0;
  border-top:1px solid #f0f3f9;` (note: every row has a top hairline, including the first)
  - **StatusDot**: `width:8px; height:8px; border-radius:50%; background:{a.dot}; flex:none;`
  - Name/note column: `display:flex; flex-direction:column; flex:1; gap:1px;`
    - Name: `font-size:12.5px; font-weight:600;`
    - Note: `font-size:11px; color:#869db3;`
  - **EvalScore**: `font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#4a5662; flex:none;`
  - **AutonomyTag**: `font-size:10px; font-weight:600; color:#0a6b94; background:#e7f5fa;
    border-radius:4px; padding:2px 6px; flex:none;`
- **WorkforceFootnote**: `font-size:10.5px; line-height:1.5; color:#869db3;` → text:
  'Autonomy graduates on written criteria, never on "seems fine". Exceptions caused per 100 runs
  must fall monthly.' (note: straight double-quotes around "seems fine")

**AdverseImpactCard**:
- `background:#063f58; border-radius:12px; padding:16px 18px; display:flex; flex-direction:column;
  gap:7px;` (no border, no shadow — distinct from the white cards)
- Header: `font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  color:#90cfea;` → "Adverse-impact monitor"
- Body: `font-size:12.5px; line-height:1.55; color:#d6ecf7;` → "All shortlist ratios within band
  this cycle. Full view lives in the Shortlist Sampler with per-cycle history."
- Meta: `font-family:'JetBrains Mono',monospace; font-size:11px; color:#5eb9e0;` → "last run:
  Jul 1, 06:00 · next: Jul 8"

### Toast
- `position:fixed; bottom:28px; left:50%; transform:translateX(-50%); background:#1e1e1e;
  color:#fff; border-radius:100px; padding:12px 22px; font-size:13px; font-weight:500;
  box-shadow:0 8px 24px rgba(30,30,30,.25); z-index:99;
  animation:slfade 200ms cubic-bezier(.2,0,0,1);`
- Note: because the toast base transform is `translateX(-50%)` and the `slfade` keyframe animates
  `transform`, the entrance animation momentarily overrides the horizontal centering during the
  200 ms (see Interactions for exact keyframe behavior — a faithful reproduction should keep this,
  a corrected version would compose the translateY into the transform to preserve centering).

### Keyframe
```css
@keyframes slfade { from { transform:translateY(7px);} to { transform:none;} }
```
- Duration/easing on every use: `200ms cubic-bezier(.2,0,0,1)`.
- **Important:** the actual keyframe animates **transform only** (a 7px rise). There is **no opacity
  fade** despite the name "slfade" and despite the handoff README describing "fade+rise 7px
  (~240ms)". Reproduce the source: transform-only, 200ms. If you want the README's fade, add
  `opacity:0 → 1`, but that is a deviation from the prototype.

---

## Interactions & state machine

All interactivity is one component class (`DCLogic` subclass). Port to React state.

### Client state
```
state = {
  resolved: {},   // map: exceptionId -> resolution label string. Empty at load.
  toast: null     // string | null. The currently displayed toast message.
}
```
Plus one non-state timer handle `this.tt` (setTimeout id for auto-dismissing the toast).

### Derived values (recomputed every render)
- `defs` = the static array of 6 exception definitions (see Seed data).
- `openCount = defs.filter(d => !resolved[d.id]).length` — starts at 6, decrements as items resolve.
- `allDone = openCount === 0`.
- For each queue item `d`:
  - `openItem = !resolved[d.id]` (render ExceptionCard)
  - `doneItem = !!resolved[d.id]` (render ResolvedRow)
  - `resolvedAs = resolved[d.id] || ''` (the bold label in the resolved row)

Render order: the queue maps over `defs` in fixed order (e1…e6). Each slot renders **either** the
open card **or** the resolved row for that same id — position never changes. Below the whole list,
the empty-state panel renders only when `allDone`. The toast renders when `toast` is non-null.

### Event handlers (three per card; all mutate `resolved` and fire a toast)

**Approve recommended** (`approve`):
1. `setState(resolved = { ...resolved, [id]: 'Approved recommended' })`
2. `pop('Done in one click. Resolution logged as eval data for the ' + agent + '.')`
   — e.g. for the Verifier card: "Done in one click. Resolution logged as eval data for the
   Verifier." (the `agent` interpolated is the item's short agent name — see per-item values below).

**Override** (`override`):
1. `setState(resolved = { ...resolved, [id]: 'Overridden by operator' })`
2. `pop('Override logged. The ' + agent + ' learns from the diff between its call and yours.')`
   — e.g. "Override logged. The Recruiter learns from the diff between its call and yours."

**Escalate to lead** (`escalate`):
1. `setState(resolved = { ...resolved, [id]: 'Escalated to Platform Lead' })`
2. `pop('Escalated with full context. It lands in the lead\'s Monday digest thread.')`
   — this toast is **fixed** (does not interpolate the agent name).

The resolution labels stored in `resolved` are exactly:
- Approve → `Approved recommended`
- Override → `Overridden by operator`
- Escalate → `Escalated to Platform Lead`
These strings appear (bold) in the ResolvedRow. Note the label wording differs slightly from the
button/verb ("Approve recommended" button → "Approved recommended" label; "Escalate to lead" button
→ "Escalated to Platform Lead" label).

### Toast mechanism (`pop(msg)`)
```
pop(msg) {
  setState(toast = msg);
  clearTimeout(this.tt);
  this.tt = setTimeout(() => setState(toast = null), 2800);
}
```
- One toast at a time. A new `pop` clears the prior timer and restarts a fresh 2800 ms countdown,
  replacing the visible message immediately. On unmount, clear `this.tt`.
- Toast entrance uses the `slfade` animation (200 ms rise). There is no explicit exit animation — it
  simply unmounts when `toast` returns to null after 2800 ms.

### Transitions summary
- **On any resolve action:** the acted card's slot flips from ExceptionCard → ResolvedRow (in place,
  same position). The subtitle `{openCount}` decrements by 1. A toast appears bottom-center for
  2800 ms. No other card changes.
- **On the sixth/last resolve:** in addition to that card collapsing, `allDone` becomes true and the
  QueueEmptyState panel appears appended below the resolved rows. (The final toast still fires.)
- **No reversal:** there is no handler to un-resolve. Resolved rows have no interactive controls.

### Animation catalog
| Element | Trigger | Animation |
|---|---|---|
| ExceptionCard | mount / initial render | `slfade 200ms cubic-bezier(.2,0,0,1)` (7px rise) |
| Toast | appears | `slfade 200ms cubic-bezier(.2,0,0,1)` (7px rise) |
| ResolvedRow | appears | none declared (it just replaces the card) |
| QueueEmptyState | appears | none declared |

Per the handoff motion spec (applies globally): motion 120–280 ms, `cubic-bezier(.2, 0, 0, 1)`;
hover darkens, never scales or lifts (the button hovers here follow that — background/border shifts
only). Respect `prefers-reduced-motion` in production (handoff flags reduced-motion variants as a
pending design task; suppressing the `slfade` translate is the safe default).

---

## Copy, verbatim

Sentence case is intentional. No em dashes. Reproduce exactly (including the `·` middot, the `↓`
arrow, the `→` arrow, `×` where used, and straight quotes).

### Header
- Hub back link: `Hub`
- Brand: `Talent Ops`
- Scope pill: `internal · volunteers handle exceptions, agents handle everything else`
- Digest stamp: `wk 27 · Mon digest sent 8:02 AM`
- Operator avatar initial: `L`

### Queue header
- Title: `Exception queue`
- Subtitle: `{openCount} open · every item arrives with agent context and a recommended action · target median under 2 minutes`
  (initial `{openCount}` = `6`)
- Median stamp: `median this wk: 1.4 min`

### Exception card chrome
- Recommended label (bold prefix): `Recommended:`
- Approve button: `Approve recommended`
- Override button: `Override`
- Escalate button: `Escalate to lead`

### Resolved rows
- Trailing stamp: `logged → eval data`
- Resolution labels (bold): `Approved recommended` / `Overridden by operator` / `Escalated to Platform Lead`

### Empty state
- `Queue clear. The agents have the rest. See you at the Monday digest.`

### Toasts
- Approve: `Done in one click. Resolution logged as eval data for the {agent}.`
- Override: `Override logged. The {agent} learns from the diff between its call and yours.`
- Escalate: `Escalated with full context. It lands in the lead's Monday digest thread.`
  (uses a straight apostrophe in "lead's")

### Sidebar
- Week stats header: `This week`
- Agent workforce header: `Agent workforce`
- Agent workforce right label: `eval / autonomy`
- Workforce footnote: `Autonomy graduates on written criteria, never on "seems fine". Exceptions caused per 100 runs must fall monthly.`
- Adverse-impact header: `Adverse-impact monitor`
- Adverse-impact body: `All shortlist ratios within band this cycle. Full view lives in the Shortlist Sampler with per-cycle history.`
- Adverse-impact meta: `last run: Jul 1, 06:00 · next: Jul 8`

Full per-item exception copy (titles, contexts, recommendations) is in Seed data below.

---

## Demo / seed data

This becomes the database seed so the production app renders identically. All values are verbatim
from `queueDef()` and `renderVals()` in the source.

### Exception queue — 6 items (order fixed e1 → e6)

Category tag color map (used by CategoryTag: `catFg` = text color, `catBg` = background):

| Category | catFg | catBg | Family |
|---|---|---|---|
| Verification conflict | `#654a00` | `#fdf6e3` | amber |
| Low-confidence shortlist | `#0a6b94` | `#e7f5fa` | blue |
| Policy refusal | `#991a30` | `#fdf2f4` | red |
| SLA risk | `#654a00` | `#fdf6e3` | amber |
| Student report | `#4a5662` | `#f0f4f8` | gray |
| Consent edge | `#991a30` | `#fdf2f4` | red |

**e1**
- `cat`: `Verification conflict` · `catBg`: `#fdf6e3` · `catFg`: `#654a00`
- `agent`: `Verifier` · `age`: `2h`
- `title`: `Repo authorship: claimed solo, git shows a second committer`
- `context`: `railforge repo, candidate hzhang: 38% of early commits by another account. Student was asked first, replied "pair-programmed week one, solo after". Commit timeline is consistent with that.`
- `rec`: `Accept the explanation, relabel the evidence "shared early, solo after week 1". No penalty; the label just gets honest.`

**e2**
- `cat`: `Low-confidence shortlist` · `catBg`: `#e7f5fa` · `catFg`: `#0a6b94`
- `agent`: `Recruiter` · `age`: `4h`
- `title`: `PM Intern (Scogle): only 7 clear the bar, not 10`
- `context`: `Pool depth for PM archetype is thin this cycle: 7 candidates above threshold, next 3 are 9+ points below. Padding to ten would dilute the slate.`
- `rec`: `Deliver 7 with the standard pool-health note. Padding is how sponsor trust dies.`

**e3**
- `cat`: `Policy refusal` · `catBg`: `#fdf2f4` · `catFg`: `#991a30`
- `agent`: `Concierge` · `age`: `5h`
- `title`: `Sponsor asked to filter for "native English speakers"`
- `context`: `Refused at intake as a protected-class proxy, per policy. A decline message is drafted that offers the lawful alternative: a communication rubric scored from the screen.`
- `rec`: `Approve the drafted decline + alternative. Wording is calibrated to keep the relationship warm.`

**e4**
- `cat`: `SLA risk` · `catBg`: `#fdf6e3` · `catFg`: `#654a00`
- `agent`: `Sentinel` · `age`: `1d`
- `title`: `Research Intern intake idle for 3 days, clock never started`
- `context`: `Sponsor answered one of two intake questions and went quiet. SLA has not started, but the sponsor may believe it has. Nudge email drafted.`
- `rec`: `Send the drafted nudge. It restates that the 72h clock starts at confirmation, not at posting.`

**e5**
- `cat`: `Student report` · `catBg`: `#f0f4f8` · `catFg`: `#4a5662`
- `agent`: `Synthesizer` · `age`: `1d`
- `title`: `Student says a dossier quote mis-transcribed "Paxos" as "taxes"`
- `context`: `Re-transcription confirms the student is right. Corrected diff attached; dossier is unpublished pending the fix, student notified.`
- `rec`: `Apply the corrected transcript and re-send for the student's approval.`

**e6**
- `cat`: `Consent edge` · `catBg`: `#fdf2f4` · `catFg`: `#991a30`
- `agent`: `Talent Rep` · `age`: `2d`
- `title`: `Student paused mid-call during the consent re-read`
- `context`: `Student hesitated when recording consent was restated verbally, then asked to stop. Call ended cleanly; per hard rule nothing was retained. Rep offered the text-mode equivalent.`
- `rec`: `Confirm zero retention and send the text-mode invitation. No follow-up pressure.`

Note: the `agent` field on each exception is the **short** agent name and is interpolated into the
approve/override toasts (e.g. "…for the Verifier."). These short names (`Verifier`, `Recruiter`,
`Concierge`, `Sentinel`, `Synthesizer`, `Talent Rep`) differ from the workforce list display names
below (`Ops Sentinel`, `Profile Synthesizer`). Keep both mappings in the seed.

### This week — 5 stats (in order)

`w.l` = label, `w.n` = value, `w.c` = value color.

| Label (`w.l`) | Value (`w.n`) | Color (`w.c`) |
|---|---|---|
| Exceptions per 100 agent runs | `0.8 ↓` | `#0d4b17` (green, trending down) |
| Operator hours logged | `3.6 h` | `#1e1e1e` (ink) |
| Screens completed | `214` | `#1e1e1e` (ink) |
| Cost per completed screen | `$3.40` | `#1e1e1e` (ink) |
| Shortlists on time | `9 / 9` | `#0d4b17` (green) |

The `↓` is a literal down-arrow glyph inside the value string. Only the two "good/on-track" metrics
(exceptions-per-100 and shortlists-on-time) use green; the rest use ink.

### Agent workforce — 6 agents (in order)

`a.name`, `a.note`, `a.eval`, `a.aut` (autonomy tag), `a.dot` (status-dot color).

| Name (`a.name`) | Note (`a.note`) | Eval (`a.eval`) | Autonomy (`a.aut`) | Dot (`a.dot`) |
|---|---|---|---|---|
| Talent Rep | voice screens | `4.7` | `A` | `#3a9a4c` (green) |
| Profile Synthesizer | student approves output | `4.8` | `A` | `#3a9a4c` (green) |
| Verifier | claims × artifacts | `4.5` | `B` | `#3a9a4c` (green) |
| Recruiter | 1-in-5 shortlists sampled | `4.4` | `B` | `#e8b13a` (amber) |
| Concierge | reads A · commits C | `4.6` | `A/C` | `#3a9a4c` (green) |
| Ops Sentinel | this queue, the digest | `4.6` | `B` | `#3a9a4c` (green) |

Notes: the "note" field for Verifier contains a literal `×` (multiplication sign): `claims × artifacts`.
Concierge's autonomy tag is the compound `A/C` (rendered in the same single AutonomyTag pill). All
AutonomyTags share the same style (blue text `#0a6b94` on `#e7f5fa`), regardless of A/B/C — the
letter is the only differentiator. Only Recruiter's dot is amber; all others are green.

---

## SVG & iconography

Icons are Lucide-style, 24×24 viewBox, `fill:none`, `stroke:currentColor` unless a color is set,
`stroke-linecap:round`, `stroke-linejoin:round`. Production should use `lucide-react`.

**1. Arrow-left (Hub back link)** — Lucide `arrow-left` (`ArrowLeft`)
- Rendered 14×14, `stroke-width:2`, `stroke:currentColor` (inherits link color `#aebdcc`).
- Paths: `M19 12H5` and `m12 19-7-7 7-7`

**2. Wand-sparkles (Recommended line)** — Lucide `wand-sparkles` (`WandSparkles`) [closest match]
- Rendered 14×14, `stroke:#0a6b94`, `stroke-width:2`.
- Paths:
  `M15 4V2m0 20v-2M8 9l-1.5-1.5M19 20l-1.5-1.5M2 15h2m16 0h2M19 4l-9.5 9.5`
  and `m14.5 9.5 1 1`
- Geometry: a starburst of short strokes radiating around the point (15,15) on the four axes and the
  two upper diagonals, a long diagonal "wand" line from (19,4) to (9.5,13.5), plus a small tick from
  (14.5,9.5) to (15.5,10.5). If `wand-sparkles` does not match visually, hand-inline these exact
  paths.

**3. Check (Resolved row)** — Lucide `check` (`Check`)
- Rendered 14×14, `stroke:#0d4b17`, `stroke-width:2.4` (heavier than the default 2).
- Path: `M20 6 9 17l-5-5`

There is no brand glyph / conic-gradient tile / tartan band on this screen (those signature elements
appear on the student/sponsor surfaces only, per the handoff — never on ops chrome). The operator
avatar is a plain flat `#0e96d1` circle with a letter, not a gradient tile.

---

## Accessibility & floors

From the handoff, applied to this surface:
- **Tap targets:** 44px minimum. The action buttons here are **34px tall** (`height:34px`) — below
  the 44px floor. This is a desktop internal console (mouse-driven), which is why the prototype uses
  34px. Production decision: either keep 34px for desktop density or bump hit area to 44px (padding
  the clickable region without changing visual height) for touch/accessibility compliance. Flag.
- **Type-size floors:** handoff floors are student app 12.5px, sponsor tables 12px. This ops surface
  goes as small as **10px** (category tags, autonomy tags), **10.5px** (workforce footnote and right
  label), and **11px** (agent note, age stamp, digest/adverse-impact meta). These are decorative
  labels/metadata, but note they are below the readable-body floors; verify contrast at these sizes.
- **Contrast notes:** the dark header uses `#869db3` and `#aebdcc` text on `#1e1e1e` — muted but
  intended. Muted labels `#869db3` on white (workforce notes, stamps) and `#5f6f7f` on white
  (subtitle) are low-contrast by design; keep, but do not use them for anything load-bearing.
- **Focus order & keyboard:** not specified in the prototype (handoff lists focus order as a pending
  a11y task). Provide logical tab order across the three buttons per card and visible focus rings.
- **Reduced motion:** handoff flags reduced-motion variants as pending. Gate the `slfade` translate
  behind `prefers-reduced-motion: no-preference`.
- **Semantics:** the toast should be an `aria-live="polite"` region so resolutions are announced.
  Category and autonomy tags are meaningful, not decorative — give them accessible text, not just
  color (color-family is currently the only differentiator between amber/blue/red/gray categories).

---

## Layout & responsive notes

- Container is `max-width:1280px`, centered, `padding:26px 28px 56px`. Columns: left `flex:1.7`
  (fluid), right `320px` fixed, `gap:20px`, `align-items:flex-start` so the sticky sidebar can
  scroll-pin independently.
- Sidebar `position:sticky; top:82px` (56px header + 26px top body padding). The header is
  `position:sticky; top:0; z-index:50`. Toast is `z-index:99`.
- **No responsive breakpoints are defined** in the prototype. The handoff explicitly lists "Sponsor
  portal responsive behavior below 1100px" as not-yet-designed; the ops console is desktop-only in
  the same spirit. Below ~700px the two-column layout will overflow. Flag for a design pass; do not
  improvise a mobile layout.

---

## Ambiguities / simulated-only — implementer decisions

- **Data is fully simulated.** The 6 exceptions, 5 stats, 6 agents, and all stamps ("wk 27",
  "median this wk: 1.4 min", "Mon digest sent 8:02 AM", "1.4 min", "$3.40", "214") are hardcoded.
  Production must source these from the real exception store, agent-eval pipeline, and weekly rollup.
- **No un-resolve / undo.** Resolution is one-way and in-memory in the prototype. Decide persistence,
  whether escalation/override open a follow-up flow (the prototype just collapses the row), and
  whether resolved rows should eventually leave the queue.
- **Override has no editor.** The button immediately resolves as "Overridden by operator" with no UI
  to capture what the override actually was. Real override needs an input flow (out of scope here).
- **Escalate target is implied** ("Platform Lead" / "the lead's Monday digest thread"); wire to a
  real recipient/thread.
- **Adverse-impact card is a stub** — mentions "Shortlist Sampler" (phase 2) but does not link.
- **Operator identity** is a static "L" avatar on `#0e96d1`; source from the signed-in user.
- **34px buttons vs 44px tap floor** and **sub-12.5px label sizes** — reconcile with a11y (above).
