# Tokens and canonical picks — Explorations board (`Explorations.dc.html`)

Implementation spec for engineers recreating the ScottyLabs Talent Platform (Tartan Talent) design
system in React (Next.js App Router, TypeScript) with `lucide-react`.

**What this file is.** `Explorations.dc.html` is the *options board*: a design-history artifact that
laid out variant treatments (ids `1a`-`1i`, `2a`) so the team could pick winners in chat. Per the
handoff README, only three were canonized and matter for production:

- **`2a`** — the canonical audio highlight player (lives in **DossierView → Screen tab**).
- **`1d`** — the shortlist **CandidateCard** density (lives in **Sponsor Shortlist**).
- **`1h`** — the **Talent Graph** layout (lives in **Living Profile**).

**Do not build the board itself as a production screen.** Extract the three canonized components into
their real homes (named above), and turn the "Design tokens" section at the bottom into CSS custom
properties. The other options (`1a`, `1b`, `1c`, `1e`, `1f`, `1g`, `1i`) are listed once for history
and then dropped.

**Fidelity note / source-of-truth conflict you must resolve.** The board's `2a`/`1d` are the
*exploration* renders. The handoff README describes slightly *refined* production values for the same
components (e.g. README says the canonical player has a 46px play button, 14px/600 title, 42-bar
waveform, 5px progress; the board's `2a` shows 42px, 13.5px/600, 30 bars, 4px progress). Both sets of
numbers appear below, clearly labeled **[board]** vs **[README]**. Where they differ, the production
build should follow **[README]** (it is the newer spec and matches the DossierView / Shortlist target
screens); the **[board]** numbers are the literal pixels of this file and are given so nothing is lost.
Flag any remaining ambiguity to design.

---

## Screen inventory

This file renders as **one vertically-scrolling canvas page** (no routing, no overlays). Background is
`#f0eee9` (the board canvas — note this is NOT the app canvas `#f0f4f8`). Two `<section>`s stacked top
to bottom, plus in-page anchor navigation. There are no screen-to-screen transitions; every "state" is
static except the four live audio players, which animate on click.

| Order | Section id | Eyebrow | Title | Contains |
|---|---|---|---|---|
| 1 | `#t2` | `2` (dark chip) | Canonized per your feedback | Option `2a` only (the winner, shown large) |
| 2 | `#t1` | `1` (dark chip) | Explorations · audio player treatments, shortlist density, Living Profile layouts | Groups A/B/C, options `1a`-`1i` |

**Section `#t2`** (padding `40px 44px 36px`, `border-bottom:1px solid rgba(0,0,0,.08)`):
- Header row: numbered chip `2` + title + right-aligned `← Hub` link (`#0e96d1`, → `Talent Hub.dc.html`).
- Description paragraph (with inline anchor links to `#1a`, `#1d`, `#1h`).
- Single option card `2a`, width `470px`.

**Section `#t1`** (padding `40px 44px 36px`, no bottom border):
- Header row: numbered chip `1` + title + `← Hub` link.
- Description paragraph.
- Three groups, each a `flex-direction:column; gap:12px` block, separated by `gap:30px`:
  - **Group A** — "A · The audio highlight player, three ways": options `1a`, `1b`, `1c` (each `430px`).
  - **Group B** — "B · Shortlist candidate card, three densities": options `1d`, `1e`, `1f` (each `470px`).
  - **Group C** — "C · Living Profile, three layout ideas (mobile)": options `1g`, `1h`, `1i` (each `320px`).
- Footer paragraph ("Try next: …").

**Navigation.** All navigation is anchor-based (`href="#id"`, `scroll-margin-top:16px` on each option
container). Each option carries a monospace id badge that is itself an anchor to itself. The only
cross-file links are the two `← Hub` links and the inline `Talent Hub.dc.html` references. **None of
this navigation is production** — it is board plumbing.

---

## Component tree

The board is not a production surface, so the tree below maps each **canonized** exploration to the
**production component** it becomes (names taken from the handoff README where they exist). The
rejected variants are not componentized.

```
(Design-history board — not built in production)

Canonized extractions → production homes:

AudioHighlightPlayer            ← option 2a   (rendered inside DossierView, "Screen" tab)
├─ PlayButton                   (42/46px circle, #063f58, toggles play/pause icon)
├─ PlayerHeader                 (title + meta + mono position/duration)
├─ Waveform                     (30 [board] / 42 [README] animated bars)
├─ ProgressTrack                (4/5px, fill #0e96d1 on #e9ebf8)
├─ SyncedTranscript             (words flip color+weight as playback passes)
└─ RepNote                      (uppercase tag "Rep's note" + trust sentence)

CandidateCard                   ← option 1d   (one row of Sponsor Shortlist; ten per list)
├─ RankNumber                   (mono, #aebdcc)
├─ Avatar                       (rounded-square, #063f58, initials)
├─ CandidateIdentity            (name + school/date meta + fit score)
├─ Rationale                    (two-sentence body)
├─ EvidenceChips                (blue-tint tag pills)
└─ CardActions                  (Request intro / Pass / Save pills)

TalentGraph                     ← option 1h   (a card inside Living Profile)
├─ GraphTitle                   ("June's Talent Graph")
├─ SkillColumn
│  └─ SkillChip × n             (states: selected / verified / self-reported)
├─ ElbowConnector               (2px #90cfea L-shaped rule)
├─ EvidenceColumn
│  └─ EvidenceCard × n          (3px provenance-colored left edge; states: verified / audio / missing)
└─ GraphFootnote
```

All four players on the board share one piece of state (`{ playing, t }`) and one 100ms ticker; see
the state machine section. In production each `AudioHighlightPlayer` instance owns its own playback
state (driven by real presigned-URL streaming + word timestamps, per ARCHITECTURE.md).

---

## Exact styles per component

### Canonical audio player — option `2a` (→ `AudioHighlightPlayer`)

**Board container** `#2a`: `flex:none; display:flex; flex-direction:column; gap:9px; scroll-margin-top:16px; width:470px`.
Above the card sits the board label row (drop in production): `display:flex; align-items:baseline; gap:8px; font:400 11px/1.3 Inter; color:rgba(0,0,0,.55)` with a mono id badge and the caption "The canonical highlight player · live, press play".

**Card shell** `[board]`:
```
background:#fff;
border:1px solid rgba(0,0,0,.08);
border-radius:14px;
padding:16px 18px;
display:flex; flex-direction:column; gap:11px;
box-shadow:0 1px 3px rgba(0,0,0,.06);
```

**Row 1 — header** `display:flex; align-items:center; gap:12px`:
- **Play button** `[board]`: `width:42px; height:42px; border-radius:50%; border:none; background:#063f58; cursor:pointer; display:flex; align-items:center; justify-content:center; flex:none`. `[README]` calls for **46px**. Icon is white (`fill:#fff`), swaps on state:
  - Playing → pause glyph: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="5" y="4" width="4.5" height="16" rx="1.5"/><rect x="14.5" y="4" width="4.5" height="16" rx="1.5"/></svg>`
  - Paused → play glyph: `<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15l13-7.5z"/></svg>`
- **Title block** `display:flex; flex-direction:column; gap:1px; flex:1`:
  - Title: `font:600 13.5px Inter; color:#1e1e1e` `[board]` — `[README]` says **14px/600**. Text: "Debugging under pressure".
  - Meta: `font:400 11px Inter; color:#869db3`. Text `[board]`: "minute 14:42 · stream only, plays logged". `[README]` canonical meta: "streamed, never downloadable, every play lands in the student's ledger".
- **Position/duration**: `font:500 11px 'JetBrains Mono',monospace; color:#869db3`. Text: `{pos} / 0:08` (see state machine for `pos`).

**Row 2 — waveform** `display:flex; align-items:flex-end; gap:2px; height:24px`. Contains **30 bars** `[board]` (`[README]` says **42**). Each bar:
```
flex:1;
height:{h}px;              /* h = 6 + ((i*37)%20)  → range 6–25px, 20-value repeating cycle */
border-radius:2px;
background:rgba(14,150,209,.45);
transform-origin:bottom;
animation:slpulse 800ms ease-in-out infinite;
animation-delay:{d}ms;     /* d = (i*97)%500  → 0–485ms staggered */
animation-play-state:{running|paused};  /* running only while this player is playing */
```
Bar-height sequence for i=0..19 (then repeats): `6,23,20,17,14,11,8,25,22,19,16,13,10,7,24,21,18,15,12,9`. At rest the `slpulse` keyframe holds each bar at `scaleY(.35)` (see keyframes in Design tokens). Bars animate **only while playing**.

**Row 3 — progress track** `[board]` `height:4px; border-radius:100px; background:#e9ebf8; overflow:hidden` (`[README]` says **5px**), fill: `height:100%; background:#0e96d1; width:{pct}; transition:width 90ms linear`.

**Row 4 — synced transcript** `font:400 13px/1.7 Inter` `[board]` (`[README]` says **14px/1.75**). Each word is a `<span>` with `color:{c}; font-weight:{wt}; transition:color 100ms`. Words already played render `color:#1e1e1e; font-weight:600`; unplayed words render `color:#aebdcc; font-weight:400`. (In `2a` the `mk('d', '#1e1e1e', '#aebdcc')` mapping supplies these two colors.)

**Row 5 — rep's note** `border-top:1px solid #e9ebf8; padding-top:9px; display:flex; gap:8px; align-items:flex-start`:
- Tag: `font:600 10px Inter; letter-spacing:.05em; text-transform:uppercase; color:#0a6b94; background:#e7f5fa; border-radius:4px; padding:3px 7px; flex:none`. Text: "Rep's note".
- Body: `font:400 11.5px/1.5 Inter; color:#4a5662`. Text: "Unprompted failure analysis, symptom to proof. Every play lands in June's ledger."

**States.** Only two visual states, driven by playback: **paused** (play glyph, bars frozen at `scaleY(.35)`, progress width `0%`, all words gray/400, position `0:00`) and **playing** (pause glyph, bars animating, progress fills 0→100% over 8s, words flip to ink/600 left-to-right, position counts up). No hover/disabled states are defined on the board. Production should add: play button hover darkens (`#063f58`→ slightly darker), 44px minimum tap target already met (42/46px + card padding), focus ring for keyboard users.

**[README] additions for the production Screen tab (not present on the board, include them):** below the
player a **clip list** — mono timestamp + tag + duration rows; the selected clip row uses
`background:#f8fafc` with a `#90cfea` border.

---

### Shortlist card — option `1d` (→ `CandidateCard`)

**Board container** `#1d`: `width:470px` (label row + card). Board caption: "Calm · rationale leads, one candidate per breath (in the prototype)".

**Card shell** `[board]`:
```
background:#fff;
border:1px solid rgba(0,0,0,.08);
border-radius:12px;
padding:16px 18px;
display:flex; gap:14px; align-items:flex-start;
box-shadow:0 1px 3px rgba(0,0,0,.06);
```

**Left — rank number**: `font:600 14px 'JetBrains Mono',monospace; color:#aebdcc; padding-top:5px`. Text: "1".

**Avatar** `[board]`: `width:40px; height:40px; border-radius:11px; background:#063f58; color:#fff; display:flex; align-items:center; justify-content:center; font:600 14px Inter; flex:none`. Initials "JP". `[README]` production Shortlist uses a **44px** avatar.

**Body** `display:flex; flex-direction:column; gap:6px; flex:1`:
- **Identity row** `display:flex; align-items:center; gap:8px`:
  - Name: `font:600 14.5px Inter` `[board]` — `[README]` production is **15.5px/600**, hover color `#0e96d1`. Text: "June Park".
  - Meta: `font:400 11px Inter; color:#869db3`. Text: "SCS · May 2027".
  - Fit score: `font:500 11px 'JetBrains Mono',monospace; color:#5f6f7f; margin-left:auto`. Text: "fit 94".
- **Rationale**: `font:400 12px/1.55 Inter; color:#38424b` `[board]` — `[README]` production is **13px**. Text (two sentences): "Strongest evidence-to-claim ratio in the pool. Verified Raft consensus work maps directly onto your storage replication team."
- **Evidence chips** `display:flex; gap:5px; flex-wrap:wrap`. Each chip: `font:500 10.5px Inter; color:#0a6b94; background:#e7f5fa; border:1px solid #b4def1; border-radius:4px; padding:3px 7px`. Three chips: "15-440 consensus, verified" · "railtrace, Go" · "3 strong moments".
- **Actions** `display:flex; gap:6px; padding-top:2px` (rendered as `<span>` on the board; make them `<button>`):
  - Primary "Request intro": `height:30px; display:inline-flex; align-items:center; padding:0 14px; border-radius:100px; background:#1e1e1e; color:#fff; font:600 11px Inter`.
  - Secondary "Pass": `height:30px; display:inline-flex; align-items:center; padding:0 12px; border-radius:100px; border:1px solid #c7d2dc; color:#4a5662; font:600 11px Inter`.
  - Secondary "Save": same as Pass.

**States** `[README]` (not on the board — add in production): passed cards dim to **45% opacity**; "Pass" opens a required one-tap reason row (Too junior / Missing a must-have / Overlaps existing hire / Other); name hover → `#0e96d1`; badges may appear before the name (Wildcard purple, Alum blue, Match-only gray); match-only candidates render anonymized (gray avatar, "consent requested" copy). Production actions are **44px** tap targets (the board's 30px pills are density-study values only).

---

### Talent Graph — option `1h` (→ `TalentGraph`)

**Board container** `#1h`: `width:320px` (mobile column). Board caption: "Evidence threads · claims wired to their proof".

**Card shell** `[board]`:
```
background:#fff;
border:1px solid rgba(0,0,0,.08);
border-radius:18px;
padding:16px;
display:flex; flex-direction:column; gap:12px;
height:470px; overflow:hidden;
box-shadow:0 1px 3px rgba(0,0,0,.06);
```

**Title**: `font:700 15px Satoshi,Inter; letter-spacing:-0.015em`. Text: "June's Talent Graph".

**Graph body** `display:flex; gap:0; flex:1` — three lanes:

1. **Skill column** `width:118px; flex:none; display:flex; flex-direction:column; gap:8px`. Each chip is `height:28px; padding:0 10px; border-radius:100px; font:600 10.5px Inter; display:inline-flex; align-items:center; width:fit-content`, differing by provenance state:
   - **Selected** ("Distributed sys"): `background:#063f58; color:#fff` (solid, no border).
   - **Verified** ("Go"): `border:1.5px solid #90cfea; background:#e7f5fa; color:#0a6b94`.
   - **Self-reported / unverified** ("K8s"): `border:1.5px dashed #aebdcc; color:#5f6f7f` (hollow, no fill).
   `[README]` production skill chips use **radius 12px**, verified adds an "n wired" mono caption, unverified adds "no proof yet". The board omits those captions.

2. **Elbow connector** `[board]`: `width:22px; flex:none; border-left:2px solid #90cfea; margin:14px 0 0 -6px; border-radius:0 0 0 8px; height:150px; border-bottom:2px solid #90cfea`. (An L-rule: left edge + bottom edge, bottom-left rounded 8px, `#90cfea`, 2px.)

3. **Evidence column** `flex:1; display:flex; flex-direction:column; gap:7px; margin-left:-8px; padding-top:2px`. Each card: `border:1px solid #e9ebf8; border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:2px`, distinguished by a **3px colored left edge** (the provenance signal):
   - **Verified · course**: `border-left:3px solid #0e96d1`. Label `font:600 10.5px Inter` "15-440 consensus project"; caption `font:500 9px Inter; letter-spacing:.04em; text-transform:uppercase; color:#0a6b94` "Verified · course".
   - **Verified · authorship**: `border-left:3px solid #0e96d1`. "railtrace repo · 18k lines" / "Verified · authorship" (caption `#0a6b94`).
   - **Audio moment**: `border-left:3px solid #6940c9`. "Interview moment 14:42" / "Verified · audio" (caption `color:#4b2d8f`).
   - **Missing**: `border:1px dashed #c7d2dc; border-radius:8px; padding:8px 10px; opacity:.7` (no colored bar). Label `font:600 10.5px Inter; color:#5f6f7f` "Homelab config"; caption `font:500 9px Inter; …; color:#869db3` "Missing · attach to verify K8s". `[README]` renders missing at **75% opacity**.

**Footnote**: `font:400 10.5px/1.5 Inter; color:#869db3`. Text: "Tapping a skill lights up its thread. Unwired claims visibly dangle, which is the nudge."

**Interaction (specified in copy, not built on board):** tapping a skill chip "lights up its thread" —
select the chip (solid `#063f58` state) and highlight the evidence cards wired to it. Production must
implement this select-and-highlight; the board is static (only "Distributed sys" is pre-selected).

---

### Rejected options (history only — do not build)

| id | Group | One-line description | Width |
|---|---|---|---|
| `1a` | A | Deep spine · waveform + synced transcript, dark artifact (dark card `#063f58`, white play button, bars `rgba(94,185,224,.75)`, progress `#5eb9e0`). Its waveform + transcript-sync is what got lifted into canonical `2a`. | 430px |
| `1b` | A | Ticket stub · tartan spine, quote-first, light. 10px **vertical tartan spine** (recipe below), 22px mono timestamp, italic quote. | 430px |
| `1c` | A | Transcript-first · the words are the waveform. Satoshi 17px transcript, black pill "Listen"/"Pause" button. | 430px |
| `1e` | B | Power scan · ten in one screenful, rationale on demand. Compact table: header row `#f8fafc`, inline fit bars, 26px circular action buttons, expandable rationale row. | 470px |
| `1f` | B | Dossier-forward · the rubric rides on the card. Left `#063f58` rubric panel with Depth/Verification/Ownership dot ratings (`#5eb9e0` filled dots). | 470px |
| `1g` | C | Stacked cards · as built in the prototype. Phone canvas `#f5f7fa`, white sub-cards, StrengthMeter (gradient `#0e96d1→#6940c9`, value 82), skill pills. | 320px |
| `1i` | C | Timeline spine · the profile as a growing record. 3px **vertical tartan timeline** (recipe below), dated verified/pending rows. | 320px |

Two rejected recipes are still useful for the token system (vertical tartan variants) and are captured
in Design tokens below.

---

## Interactions & state machine

All four live players (`1a`=`pA`, `1b`=`pB`, `1c`=`pC`, `2a`=`pD`) are driven by **one** component
class with a **single shared state object**. Only one player can play at a time (starting one does not
explicitly stop another, but they share `state.t`, so in the board only the most-recently-toggled id
is truly "on").

**Client state (`state`):**
```js
state = { playing: null, t: 0 };
// playing: null | 'a' | 'b' | 'c' | 'd'  — which player id is active
// t:       number seconds, 0 → 8, increments 0.1 per tick
```

**Ticker (`componentDidMount`):** `setInterval(…, 100)` — every **100ms**:
```js
if (s.playing) {
  const nt = s.t + 0.1;
  if (nt >= 8) this.setState({ playing: null, t: 0 });  // auto-stop + rewind at 8s
  else this.setState({ t: nt });
}
```
Cleared in `componentWillUnmount`. So every clip is a fixed **8.0-second** loop that auto-stops and
resets to the start when it completes.

**Per-player derived values (`mk(id, darkOn, darkOff)`):**
```js
const on   = s.playing === id;
const frac = on ? Math.min(1, s.t / 8) : 0;   // 0 → 1 progress fraction
return {
  on, off: !on,
  pct:  (frac * 100) + '%',                    // progress-bar width
  pos:  '0:0' + Math.floor(on ? s.t : 0),      // "0:00" … "0:07" (mono display); paired with "/ 0:08"
  play: s.playing === id ? 'running' : 'paused', // waveform animation-play-state
  words: WORDS.map((w, i) => ({
    w:  w + ' ',
    c:  (frac > 0 && i / WORDS.length <= frac) ? darkOn : darkOff,   // played vs unplayed color
    wt: (frac > 0 && i / WORDS.length <= frac) ? 600     : 400,      // played vs unplayed weight
  })),
  toggle: () => this.setState({ playing: on ? null : id, t: 0 }),   // click resets t to 0
};
```

**Color/weight bindings by player:**
| id | played color (darkOn) | unplayed color (darkOff) | card |
|---|---|---|---|
| `pA` (1a) | `#ffffff` | `rgba(255,255,255,.45)` | dark |
| `pB` (1b) | `#063f58` | `#8ba0b3` | light |
| `pC` (1c) | `#1e1e1e` | `#aebdcc` | light |
| **`pD` (2a)** | **`#1e1e1e`** | **`#aebdcc`** | **light (canonical)** |

**Event handlers.** The only handler is the play/pause button `onClick = {toggle}`. Clicking a paused
player: sets `playing = id`, `t = 0` (starts from the beginning). Clicking a playing player: sets
`playing = null` (pause; `t` reset to 0, so re-play restarts).

**Animations / timers:**
- **Waveform** — CSS keyframe `slpulse` (below), `800ms ease-in-out infinite`, per-bar
  `animation-delay = (i*97)%500 ms`, gated by `animation-play-state: running|paused`. Runs only while
  that player is `playing`.
- **Progress fill** — `transition: width 90ms linear` (smooths each 100ms tick).
- **Transcript words** — `transition: color 100ms` as each word crosses the `frac` threshold.
- **Ticker** — 100ms interval, 8s total.

**Conditional renders.** Play vs pause glyph via `<sc-if value="{{ p.on }}">` / `<sc-if value="{{ p.off }}">`
(prototype template directive). In React this is a simple `{playing ? <Pause/> : <Play/>}`.

**Production reality (from README).** On the board this is all simulated. In production the canonical
player streams from a presigned S3 URL, uses real ASR word timestamps to drive the transcript
highlight, ticks playback at the real rate, and **logs every play to the student's Data Ledger**
("plays are logged" is a truth claim the UI makes, so the event must actually be recorded). No emitted
toast on the board; production may confirm nothing on play (silent) but must record the ledger event.

---

## Copy, verbatim

Every user-facing string in the file. Sentence case is intentional; no em dashes.

**Section headers / eyebrows / links**
- `2` (numbered chip, section `#t2`)
- "Canonized per your feedback"
- "← Hub" (appears twice, one per section)
- Description (`#t2`): "1a's waveform + the black-on-white bold transcript sync. Now the DossierView default. 1d stays the shortlist card; 1h's Talent Graph now lives in the Living Profile." (the ids `1a`, `1d`, `1h` are inline links)
- `1` (numbered chip, section `#t1`)
- "Explorations · audio player treatments, shortlist density, Living Profile layouts"
- Description (`#t1`): "Players are live: press play. Mix and match by id in chat, e.g. \"use 1b's spine with 1a's transcript sync\"."
- Group A label: "A · The audio highlight player, three ways"
- Group B label: "B · Shortlist candidate card, three densities"
- Group C label: "C · Living Profile, three layout ideas (mobile)"
- Footer (`#t1`): "Try next: \"make 1b the dossier default\" · \"combine 1e with expandable rationale\" · \"new directions for the CallRoom arc\""

**Option captions (the small line under each id badge)**
- `2a`: "The canonical highlight player · live, press play"
- `1a`: "Deep spine · waveform + synced transcript, dark artifact"
- `1b`: "Ticket stub · tartan spine, quote-first, light"
- `1c`: "Transcript-first · the words are the waveform"
- `1d`: "Calm · rationale leads, one candidate per breath (in the prototype)"
- `1e`: "Power scan · ten in one screenful, rationale on demand"
- `1f`: "Dossier-forward · the rubric rides on the card"
- `1g`: "Stacked cards · as built in the prototype"
- `1h`: "Evidence threads · claims wired to their proof"
- `1i`: "Timeline spine · the profile as a growing record"

**Canonical player `2a` (verbatim)**
- Title: "Debugging under pressure"
- Meta: "minute 14:42 · stream only, plays logged"
- Duration: "0:08" (position renders `0:00`…`0:07`)
- Transcript (the 25-word clip): "Our Raft implementation kept electing two leaders under partition. The real bug was that we persisted votedFor after the term check, not atomically with it."
- Rep's note tag: "Rep's note"
- Rep's note body: "Unprompted failure analysis, symptom to proof. Every play lands in June's ledger."

**Shortlist card `1d` (verbatim)**
- Name: "June Park" · Meta: "SCS · May 2027" · Fit: "fit 94"
- Rationale: "Strongest evidence-to-claim ratio in the pool. Verified Raft consensus work maps directly onto your storage replication team."
- Chips: "15-440 consensus, verified" · "railtrace, Go" · "3 strong moments"
- Buttons: "Request intro" · "Pass" · "Save"

**Talent Graph `1h` (verbatim)**
- Title: "June's Talent Graph"
- Skill chips: "Distributed sys" · "Go" · "K8s"
- Evidence label / caption pairs:
  - "15-440 consensus project" / "Verified · course"
  - "railtrace repo · 18k lines" / "Verified · authorship"
  - "Interview moment 14:42" / "Verified · audio"
  - "Homelab config" / "Missing · attach to verify K8s"
- Footnote: "Tapping a skill lights up its thread. Unwired claims visibly dangle, which is the nudge."

**Copy also present in rejected options (kept for completeness of the June narrative — reused elsewhere):**
- `1b` timestamp "14:42"; tag "Debugging under pressure"; quote "\"The real bug was that we persisted votedFor after the term check, not atomically with it.\""; note "Rep's note: complete failure analysis, unprompted. Every play lands in June's ledger."
- `1c`: "Screen highlight · 14:42"; button "Listen"/"Pause"; caption "Reads like evidence, plays like audio. No chrome to learn."
- `1e`: header "# / Candidate / Fit / Act"; "June Park" "SCS '27 · consensus, Go" 94; "Rohan Mehta" "ECE '26 · eBPF, systems" 91, expanded "Expanded row: shipped a production eBPF profiler and can defend every tradeoff. Deepest fundamentals of the slate. Open dossier →"; "Ben Okonkwo" badge "Wildcard" "Stat+ML '28 · homelab Raft" 78.
- `1f`: "Rubric" / "Depth" / "Verification" / "Ownership" / "3 audio moments ▸"; "June Park" "rank 1 · fit 94"; rationale "Verified consensus failure-handling under partition; proves fixes with 500-replay checkers rather than reruns. Wants storage work."; "Every rating links to its minute of evidence. Nothing here is unexplainable."; buttons "Request intro" / "Open dossier".
- `1g`: "June Park" "SCS · May 2027 · CPT eligible"; "Profile strength" 82; "Skills" "Distributed systems ×3" "C ×2" "React"; "RailTrace · TartanHacks, 1st" "Setup / your part / outcome, structured so sponsors read the same story you told."
- `1i`: "June, semester by semester"; rows "Jul 2026 / Talent Rep screen · 3 moments / VERIFIED · AUDIO", "Feb 2026 / RailTrace wins TartanHacks / VERIFIED · DEVPOST", "Dec 2025 / 15-440 · consensus project / VERIFIED · COURSE", "Aug 2025 / Meridian Robotics internship / PENDING · VERIFIER", "Dec 2026 · next / Semester refresher call opens"; footnote "Freshness is legible: the top of the spine is what matching trusts most. Built for Alex, the first-year who grows into it."

---

## Demo/seed data

The entire board narrates **one candidate, June Park**, and one screening clip. Seed the following so
the canonical components render identically. (Numbers and quotes recur across options, which is why
they must be seeded once and reused.)

**Person: June Park**
- id/initials: "JP"
- Name: "June Park"
- School / program: "SCS" (School of Computer Science, Carnegie Mellon); short form "SCS '27"
- Graduation: "May 2027"
- Work-auth / logistics chip: "CPT eligible" (from `1g`)
- Shortlist rank: 1
- Fit score: 94
- Avatar: rounded-square, `#063f58` fill, white "JP", radius 11px, 40px (board) / 44px (production)

**Screening clip (the canonical audio moment)**
- Title: "Debugging under pressure"
- Timestamp / minute: "14:42"
- Duration: 8 seconds (displayed "0:08")
- Delivery: stream only, plays logged
- Transcript (word-timestamped in production): "Our Raft implementation kept electing two leaders under partition. The real bug was that we persisted votedFor after the term check, not atomically with it." (25 words)
- Rep's note: "Unprompted failure analysis, symptom to proof. Every play lands in June's ledger."
- Alternate quote pulled from same moment (`1b`): "The real bug was that we persisted votedFor after the term check, not atomically with it."

**June's shortlist rationale + evidence (option `1d`)**
- Rationale: "Strongest evidence-to-claim ratio in the pool. Verified Raft consensus work maps directly onto your storage replication team."
- Evidence chips: ["15-440 consensus, verified", "railtrace, Go", "3 strong moments"]

**June's Talent Graph (option `1h`)**
- Skills: [{ label:"Distributed sys", state:"selected" }, { label:"Go", state:"verified" }, { label:"K8s", state:"self-reported" }]
- Evidence threads:
  - { label:"15-440 consensus project", provenance:"verified", source:"course", edge:"#0e96d1" }
  - { label:"railtrace repo · 18k lines", provenance:"verified", source:"authorship", edge:"#0e96d1" }
  - { label:"Interview moment 14:42", provenance:"audio", source:"audio", edge:"#6940c9" }
  - { label:"Homelab config", provenance:"missing", source:"attach to verify K8s", edge:"#c7d2dc dashed", opacity:0.7 }

**June's rubric scores (option `1f`, reuse for DossierView competency matrix)**
- Depth: 5/5 dots · Verification: 5/5 dots · Ownership: 4/5 dots (5th dot hollow `rgba(255,255,255,.2)`)
- "3 audio moments"
- Rationale variant: "Verified consensus failure-handling under partition; proves fixes with 500-replay checkers rather than reruns. Wants storage work."

**June's profile (option `1g`)**
- Meta line: "SCS · May 2027 · CPT eligible"
- Profile strength: 82 (meter fill 82%, gradient `#0e96d1→#6940c9`)
- Skills: [{ "Distributed systems", count:3, verified }, { "C", count:2, verified }, { "React", self-reported/dashed }]
- Experience: title "RailTrace · TartanHacks, 1st"; body "Setup / your part / outcome, structured so sponsors read the same story you told."

**June's timeline (option `1i`, reuse for a "growing record" view)**
- "Jul 2026" — "Talent Rep screen · 3 moments" — VERIFIED · AUDIO (`#4b2d8f`)
- "Feb 2026" — "RailTrace wins TartanHacks" — VERIFIED · DEVPOST (`#0a6b94`)
- "Dec 2025" — "15-440 · consensus project" — VERIFIED · COURSE (`#0a6b94`)
- "Aug 2025" — "Meridian Robotics internship" — PENDING · VERIFIER (`#654a00`)
- "Dec 2026 · next" — "Semester refresher call opens" — (future, 60% opacity, no provenance)

**Other candidates named on the board (option `1e` power-scan; seed for the full Shortlist of 10)**
- Rank 1 — June Park — "SCS '27 · consensus, Go" — fit 94 — bar `#0e96d1`
- Rank 2 — Rohan Mehta — "ECE '26 · eBPF, systems" — fit 91 — bar `#0e96d1` — expanded rationale: "Expanded row: shipped a production eBPF profiler and can defend every tradeoff. Deepest fundamentals of the slate." + "Open dossier →" link
- Rank 9 — Ben Okonkwo — badge "Wildcard" (purple) — "Stat+ML '28 · homelab Raft" — fit 78 — bar `#6940c9` (purple, marking the wildcard)

**Sponsor / team context (implied)**
- Sponsor team: "storage replication team" (June's rationale target)
- Ledger owner: "June's ledger" (the student owns the play log)

---

## SVG & iconography

**Inline SVG on the board (all in the players):**

1. **Pause glyph** (two bars) — used at every player size; scaled per player:
   ```
   <svg width="14" height="14" viewBox="0 0 24 24" fill="{color}">
     <rect x="5"    y="4" width="4.5" height="16" rx="1.5"/>
     <rect x="14.5" y="4" width="4.5" height="16" rx="1.5"/>
   </svg>
   ```
   Sizes: `2a`/`1a` 14px; `1b` 11px; `1c` 10px. Fill: `#fff` (dark `1a`, `2a`, `1c`), `#063f58` (`1b`).
   Lucide equivalent: **`Pause`**.

2. **Play glyph** (triangle):
   ```
   <svg width="15" height="15" viewBox="0 0 24 24" fill="{color}">
     <path d="M7 4.5v15l13-7.5z"/>
   </svg>
   ```
   Sizes: `2a`/`1a` 15px; `1b` 12px; `1c` 10px. Fill same as above.
   Lucide equivalent: **`Play`**.

3. **Waveform** — not an icon; 30 (board) / 42 (README) `<span>` bars, geometry in the player styles.

**Glyphs typed as text (replace with real icons/components in production):**
- `→` circular action = "Request intro" (Lucide **`ArrowRight`**); `✕` = "Pass" (Lucide **`X`**); `☆` = "Save" (Lucide **`Star`**) — all in the `1e` compact table.
- `▸` in "3 audio moments ▸" (`1f`) = Lucide **`ChevronRight`** / **`Triangle`**.

**The Scotty monogram (`assets/scottylabs-monogram.svg`) — NOT used anywhere on this board.** It is the
brand glyph used elsewhere (sponsor portal header conic-gradient tile, any brand mark). Spec, so
engineers can wire it:
```
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="55" viewBox="0 0 64 55" fill="none">
  <path d="M 3.251 55 L 0 55 C 0 49.426 … Z" fill="currentColor" fill-rule="nonzero"/>
</svg>
```
- Single path, `viewBox="0 0 64 55"`, `fill="currentColor"`, `fill-rule="nonzero"` — a Scotty terrier
  monogram (from the ScottyLabs design system).
- **Usage:** rendered **inline white** (`color:#fff` / `fill:currentColor`) **inside a conic-gradient
  brand tile** (recipe in Design tokens → brand glyph). Never colored, never on photography.

**Other asset:** `assets/scotty-logo-color.png` — full-color gradient logo, **unused in final
screens**, kept for reference only. Do not ship it.

**Icon system (README):** all other icons are Lucide-style 24px strokes, `stroke-width` 1.75–2,
`currentColor`. Production uses the **`lucide-react`** package directly. No photography anywhere. No
emoji except a single footer heart (elsewhere in the app; not on this board).

---

## Accessibility & floors

From the handoff, applied to the canonized components:
- **Tap targets: 44px minimum.** The board's play buttons (42px) and pill actions (30px) are
  density-study sizes; production must meet 44px. `[README]` canonical play button is 46px (already
  compliant); production CandidateCard actions must be 44px tall (the board's 30px pills are not).
- **Type-size floors:** student app body **12.5px minimum**; sponsor tables **12px minimum**. Note the
  board renders several sub-floor sizes (9px provenance captions, 10.5px chips, 11px metas) because it
  is a compact options board; in the real screens keep body copy at/above the floors, and reserve
  sub-12px only for uppercase mono/tag labels where the README itself uses them (e.g. 8.5–9px uppercase
  provenance captions in the Talent Graph and 10px uppercase tags).
- **Contrast:** provenance and status colors are chosen for legibility on their tints (`#0a6b94` text
  on `#e7f5fa`, `#4b2d8f` on purple contexts, etc.). Keep these exact pairings; do not recolor for
  "brand" reasons.
- **Provenance is never shamed** (README): missing/self-reported states use the same calm dashed-gray
  grammar as everything else — no red, no warning iconography. Preserve that tone.
- **Reduced motion:** the waveform (`slpulse`) and progress transitions must respect
  `prefers-reduced-motion` (README lists reduced-motion variants as a needed pass). Provide a static
  waveform + instant-jump progress fallback.
- **Keyboard / focus:** the board defines no focus states; production must add visible focus rings on
  the play button and all actions, and correct roles (`<button>`, not `<span>`, for actions).

---

## Design tokens

Consolidated token system (handoff README + everything observed in this file). Turn each group into CSS
custom properties. Where the board and README agree, the value is canonical; board-only observations
are marked.

### Fonts
- **Satoshi** — display (titles 19–28px, weight 700, `letter-spacing:-0.02em`; on this board titles use
  `700 15px` with `letter-spacing:-0.015em`). Weights loaded: 400, 500, 700, 900.
- **Inter** — all UI text. Weights: 400, 500, 600, 700.
- **JetBrains Mono** — course codes, timestamps, scores, ids. Weights: 400, 500, 600.
- **Never `system-ui`** for product type (board falls back to `Inter, system-ui, sans-serif` only as a
  loading fallback). Board also uses `ui-monospace, Menlo, monospace` for the id badges — that is board
  chrome, not product.
- Font links (board): `fontshare` Satoshi `@400,500,700,900`; Google `Inter@400;500;600;700` +
  `JetBrains+Mono@400;500;600`.

### Type scale (as observed / specified)
| Role | Family | Size / line | Weight | Letter-spacing |
|---|---|---|---|---|
| Display title (Satoshi) | Satoshi | 19–28px (board card titles 15px) | 700 | −0.02em (board −0.015em) |
| Player title | Inter | 13.5px [board] / 14px [README] | 600 | — |
| Card name (candidate) | Inter | 14.5px [board] / 15.5px [README] | 600 | — |
| Body / rationale | Inter | 12–13px / 1.55 | 400 | — |
| Player transcript | Inter | 13px/1.7 [board] / 14px/1.75 [README] | 400 (600 when played) | — |
| Meta / caption | Inter | 11px | 400 | — |
| Evidence chip | Inter | 10.5px | 500 | — |
| Uppercase tag (Rep's note) | Inter | 10px | 600 | 0.05em |
| Uppercase group label | Inter | 11px | 600 | 0.08em |
| Provenance caption | Inter | 8.5–9px | 500/600 | 0.04–0.06em |
| Mono value (fit, position, score) | JetBrains Mono | 10.5–11px | 500 | — |
| Mono big timestamp (`1b`) | JetBrains Mono | 22px | 600 | −0.02em |

### Color palette (semantic names for CSS vars)
```
/* Accent blue */
--blue-500: #0e96d1;   /* primary accent, progress fills, active nav */
--blue-600: #0d89be;   /* hover for accent */
--blue-700: #063f58;   /* deep blue: avatars, dark player, selected skill chip, rubric panel */
--blue-400: #5eb9e0;   /* dark-card waveform/progress, rubric dots */
--blue-300: #90cfea;   /* borders (verified chip, elbow connector), dark meta text */
--blue-200: #b4def1;   /* evidence-chip border */
--blue-100: #d6ecf7;   /* rubric label text on deep blue */
--blue-050: #e7f5fa;   /* verified tint fill, chip/tag background */
--blue-text: #0a6b94;  /* link / accent text on light, verified caption */

/* Ink / neutrals */
--ink-900: #1e1e1e;    /* primary ink, primary buttons */
--ink-800: #383838;    /* ink hover */
--ink-700: #38424b;    /* body */
--ink-600: #4a5662;    /* body secondary, secondary-button text */
--ink-500: #5f6f7f;    /* muted, mono fit score */
--ink-400: #869db3;    /* subtle meta, missing caption */
--ink-350: #8ba0b3;    /* 1b unplayed transcript */
--ink-300: #aebdcc;    /* disabled, rank number, unplayed transcript (canonical) */
--ink-250: #c7d2dc;    /* borders (secondary button, missing card, disabled) */
--hair-1:  #d9e1e7;    /* hairline */
--hair-2:  #e9ebf8;    /* hairline (progress track, evidence-card border, dividers) */
--hair-3:  #f0f3f9;    /* faint row divider */

/* Surfaces */
--canvas-app:   #f0f4f8;  /* app canvas (README) */
--canvas-board: #f0eee9;  /* THIS board's body background only — not product */
--chrome:       #edf1f6;
--phone-canvas: #f5f7fa;  /* 1g stacked-card background */
--well:         #f8fafc;  /* wells, selected clip row, table header */
--card:         #ffffff;
--call-screen:  #070c11;

/* Red */
--red-500: #d72444;  --red-600: #c4213e;  --red-900: #991a30;
--red-200: #f3bbc5;  --red-050: #fdf2f4;

/* Green */
--green-500: #3a9a4c;  --green-900: #0d4b17;  --green-050: #dcefe0;

/* Amber */
--amber-500: #e8b13a;  --amber-900: #654a00;  --amber-050: #fdf6e3;

/* Purple */
--purple-500: #6940c9;  --purple-900: #4b2d8f;  --purple-050: #d1c4ee;
--purple-tile: #8766d4;  /* brand-glyph conic stop only */
```
Board-only opacity accents worth noting: waveform fills `rgba(14,150,209,.45)` (canonical `2a`),
`rgba(94,185,224,.75)` (dark `1a`); dark-card progress track `rgba(255,255,255,.15)`; card border
`rgba(0,0,0,.08)`; resting shadow color `rgba(0,0,0,.06)` / `rgba(30,30,30,.05–.06)`.

### Radii scale
```
--radius-pill:    100px;   /* every button/pill, no exceptions; also progress tracks */
--radius-card:    12px;    /* standard cards (CandidateCard, home cards) */
--radius-card-lg: 14px;    /* player card, modals */
--radius-modal:   14–16px; /* dossier / overlays */
--radius-graph:   18px;    /* Talent Graph / mobile profile cards */
--radius-input:   8px;     /* inputs, evidence cards, "do this next" box */
--radius-tag:     4px;     /* tags/chips */
--radius-avatar:  11px;    /* rounded-square avatars */
--radius-id-badge:5px;     /* board id badges (board chrome only) */
```

### Shadow scale
```
--shadow-resting: 0 1px 2px rgba(30,30,30,.06);   /* README resting */
--shadow-board:   0 1px 3px rgba(0,0,0,.06);       /* every board card uses this */
--shadow-board-dark: 0 1px 3px rgba(0,0,0,.1);     /* dark 1a card */
--shadow-subcard: 0 1px 2px rgba(30,30,30,.05);    /* 1g white sub-cards */
--shadow-raised:  0 2px 8px rgba(30,30,30,.06);
--shadow-modal:   0 24px 64px rgba(6,14,20,.4);
--overlay-modal:  rgba(6,14,20,.52);
```

### Motion curves & durations
```
--ease-standard: cubic-bezier(.2, 0, 0, 1);   /* README standard */
--dur-fast: 90ms;    /* progress-bar width transition (linear) */
--dur-word: 100ms;   /* transcript color transition */
--dur-tick: 100ms;   /* playback/caption simulation interval */
--dur-ui:   120–280ms;  /* general UI motion */
--dur-content: 240ms;   /* content change fade + rise 7px */
--dur-wave: 800ms;   /* slpulse waveform loop (board); README call-screen bars 900ms */
```
Rules (README): hover **darkens**, never scales or lifts. Content changes fade + rise 7px (~240ms).
Voice/waveform bars: `scaleY` loop, staggered delays. Waveform/playback ticks at 100ms.

**Waveform keyframe (verbatim):**
```css
@keyframes slpulse { 0%,100% { transform:scaleY(.35); } 50% { transform:scaleY(1); } }
```
Applied per bar: `animation: slpulse 800ms ease-in-out infinite; animation-delay:{d}ms;
animation-play-state:{running|paused}` with `transform-origin:bottom`.
Board bar generation: `bars = Array.from({length:30}, (_,i) => ({ h: 6 + ((i*37)%20), d: (i*97)%500 }))`
→ heights 6–25px (20-step repeating cycle), delays 0–485ms.

### Tartan band (signature — premium artifacts only: shortlist header, dossier spine, dossier cards; NEVER buttons/nav/ordinary cards)

**IMPORTANT — there are TWO production tartan recipes in the shipped screens, at different stripe
pitches. Do not assume one global recipe; pick by surface:**

| Recipe | Stripe pitch | Used by (verified in source) |
|---|---|---|
| **A · Student recipe (= README canonical)** | red `0 5px` / gap to `26px`; white `26–28px` / gap to `52px`; blue rungs `0 2px` / gap to `7px` | Student App: Home PrimaryActionCard band, Living Profile ScreenDossierCard band, post-call Screen Dossier draft band, **and the sponsor-render Screen Dossier card inside the student "view as sponsor" panel** (all 5px tall) |
| **B · Sponsor-portal recipe** | red `0 6px` / gap to `30px`; white `30–32px` / gap to `60px`; blue rungs `0 2.5px` / gap to `8px` | Sponsor Portal (separate file): Shortlist header band (10px tall) and DossierView spine (12px wide) |

Note the same conceptual "Screen Dossier tartan card" renders with recipe **A** when the student app
draws the sponsor view, but recipe **B** in the standalone Sponsor Portal file — a source-level
inconsistency. If you tokenize tartan globally, decide which pitch is canonical and apply it to both;
otherwise reproduce each surface's literal recipe below for pixel fidelity.

**Recipe A — horizontal band (README canonical / student app, verbatim):**
```css
background-color:#063f58;
background-image:
  repeating-linear-gradient(90deg,
    rgba(215,36,68,.6) 0 5px, transparent 5px 26px,
    rgba(255,255,255,.18) 26px 28px, transparent 28px 52px),
  repeating-linear-gradient(0deg,
    rgba(14,150,209,.5) 0 2px, transparent 2px 7px);
```

**Recipe B — Sponsor Portal Shortlist header band (10px tall, horizontal, verbatim):**
```css
height:10px;
background-color:#063f58;
background-image:
  repeating-linear-gradient(90deg,
    rgba(215,36,68,.6) 0 6px, transparent 6px 30px,
    rgba(255,255,255,.18) 30px 32px, transparent 32px 60px),
  repeating-linear-gradient(0deg,
    rgba(14,150,209,.5) 0 2.5px, transparent 2.5px 8px);
```

**Recipe B — Sponsor Portal DossierView spine (12px wide, vertical — same pitch, axes swapped 90°):**
```css
width:12px;
background-color:#063f58;
background-image:
  repeating-linear-gradient(0deg,
    rgba(215,36,68,.6) 0 6px, transparent 6px 30px,
    rgba(255,255,255,.18) 30px 32px, transparent 32px 60px),
  repeating-linear-gradient(90deg,
    rgba(14,150,209,.5) 0 2.5px, transparent 2.5px 8px);
```

**Vertical spine variant (from board option `1b`, 10px wide, verbatim) — rotate the pattern 90°:**
```css
width:10px;
background-color:#063f58;
background-image:
  repeating-linear-gradient(0deg,
    rgba(215,36,68,.6) 0 5px, transparent 5px 24px,
    rgba(255,255,255,.18) 24px 26px, transparent 26px 48px),
  repeating-linear-gradient(90deg,
    rgba(14,150,209,.5) 0 2px, transparent 2px 7px);
```

**Thin timeline spine variant (from board option `1i`, 3px wide, verbatim):**
```css
width:3px; border-radius:100px;
background-color:#063f58;
background-image:
  repeating-linear-gradient(0deg,
    rgba(215,36,68,.7) 0 4px, transparent 4px 18px,
    rgba(14,150,209,.7) 18px 22px, transparent 22px 36px);
```
The `1b` and `1i` recipes above are **board history** (exploration options) and are NOT shipped in any
production screen — they are kept only because they document additional vertical stripe pitches the
token system may reuse. The shipped surfaces use Recipe A (student) and Recipe B (sponsor portal) only.
All variants differ in stripe pitch/opacity; keep them distinct — the horizontal band is the canonical
signature and the vertical forms are for spines/timelines.

### Brand glyph tile (conic gradient — verbatim from the Sponsor Portal source, which is the only file that renders it)
```css
/* Source HTML includes the explicit position "at 50% 50%"; the README abbreviates it away.
   Use the source form. */
background: conic-gradient(from 180deg at 50% 50%,
  #d72444 0%, #8766d4 25%, #0e96d1 55%, #063f58 80%, #d72444 100%);
box-shadow: inset 0 -5px 12px rgba(0,0,0,.25);   /* header 34px tile; the 30px Concierge-card tile omits the inset shadow */
border-radius: 9px;   /* header tile; 8px on the 30px Concierge-card tile */
```
Tile sizes in source: **34px** (portal header, radius 9, with the inset shadow) and **30px** (dashboard
Concierge card, radius 8, no inset shadow). Monogram SVG sizes: 18×16 (header) / 15×13 (Concierge card).
Inside: the white Scotty monogram (`assets/scottylabs-monogram.svg`, `fill:currentColor` set to white,
`viewBox="0 0 64 55"`). Used as the sponsor-portal brand mark; **not present on this board.**

### Provenance grammar (the five states — identical on every surface, never shamed)
| State | Border | Fill | Text/edge color | Opacity | On the board |
|---|---|---|---|---|---|
| **Verified** | solid `1.5px #90cfea` (chips) / evidence card `3px #0e96d1` left edge | tint `#e7f5fa` | caption `#0a6b94` | 1 | Go chip; 15-440 & railtrace evidence cards |
| **Self-reported** | dashed `1.5px #aebdcc` | hollow (none) | text `#5f6f7f` | 1 | K8s chip; React chip (`1g`) |
| **Pending** | (amber grammar) | amber `#fdf6e3` tint | edge/text `#e8b13a` / dark `#654a00` | 1 | "PENDING · VERIFIER" (`1i`) |
| **Audio moment** | `3px #6940c9` left edge | — | caption `#4b2d8f` | 1 | "Interview moment 14:42" card |
| **Missing** | dashed `1px #c7d2dc` | hollow | caption `#869db3` | 0.7 [board] / 0.75 [README] | "Homelab config" card |
Selected (interaction, not a provenance state): solid `#063f58` fill, white text (e.g. "Distributed
sys" chip). Rubric/hollow dot: filled `#5eb9e0`, empty `rgba(255,255,255,.2)`.

### Toast anatomy (README)
Bottom-center black pill (`#1e1e1e`), white text, 13px/500, `border-radius:100px`, `padding:12px 22px`,
`box-shadow:0 8px 24px rgba(30,30,30,.25)`, `z-index:99`, entrance `slfade 200ms cubic-bezier(.2,0,0,1)`,
positioned `bottom:28px; left:50%; transform:translateX(-50%)`. **One at a time** (a new toast clears the
prior timer and replaces the message). Fired for every consequential action (publish, intro request, pass
reason, visibility change, policy stubs).

**Auto-dismiss duration is NOT uniform across surfaces** — the README says "~2.8s" but each prototype
hardcodes its own `setTimeout`:

| Surface | Dismiss (ms) |
|---|---|
| Student App | **2600** |
| Ops Console | **2800** (matches README) |
| Sponsor Portal | **3000** |

Pick a single canonical value when tokenizing (2800ms matches the README); each surface spec documents its
literal source value. **No toast fires on the Explorations board** (the players are silent); the toast is
listed here so the token/component exists when the canonical player and CandidateCard are wired into
DossierView / Shortlist.

### Copy rules (README)
- Sentence case everywhere.
- Buttons are verbs ("Request intro", "Approve and publish to sponsors").
- Course numbers hyphenated: `15-440`.
- **No em dashes** in product copy (the board uses `·` middots and commas instead).
- Reuse trust phrases verbatim: "stream only, plays logged" / "Every play lands in June's ledger" /
  "Ships only if you approve" / "Padding is how trust dies, so we do not".
- Provenance/status copy is calm and non-shaming ("Missing · attach to verify K8s", "no proof yet").
