# Two-Week Stabilization Sprint Playbook

> Track: `production_ai_beta_90d`  
> Duration: 10 business days  
> Objective: remove top crashers and AI quality regressions after beta cut.

## 1. Scope Definition
- [ ] Include only issues affecting beta users.
- [ ] Prioritize:
  - [ ] Crashers and startup failures.
  - [ ] Data-loss or migration risks.
  - [ ] Session handoff quality regressions.
  - [ ] Search/chat hard failures and severe latency regressions.
- [ ] Defer non-critical feature requests to post-sprint backlog.

## 2. Daily Operating Rhythm
- [ ] 15-min daily triage standup:
  - [ ] New incidents
  - [ ] Top blockers
  - [ ] Same-day fix/verify owners
- [ ] Midday update in release channel with updated P0/P1 count.
- [ ] End-of-day checkpoint:
  - [ ] Fixed items merged
  - [ ] Repro status on unresolved issues
  - [ ] Risks for next day

## 3. Triage Rules
- [ ] Severity policy:
  - [ ] P0: data loss, unrecoverable startup, security breach
  - [ ] P1: core workflow blocked, repeated crashes
  - [ ] P2: degraded experience with workaround
  - [ ] P3: low-impact defects
- [ ] Every issue must include:
  - [ ] Repro steps
  - [ ] Expected vs actual behavior
  - [ ] Trace ID / diagnostics bundle path
  - [ ] Affected platform and app version

## 4. Fix Pipeline
- [ ] Create fix branch per high-severity issue.
- [ ] Add or update automated tests for each fix.
- [ ] Require green CI checks before merge.
- [ ] Ship patch releases in controlled batches (daily max one unless emergency).
- [ ] Re-verify on at least one affected user environment before close.

## 5. AI Quality Regression Handling
- [ ] Track session summary quality regressions with explicit examples.
- [ ] Track retrieval relevance regressions with query/result captures.
- [ ] Enforce fallback behavior checks (no UI dead-end on provider failure).
- [ ] Compare latency and error budgets before/after each patch.

## 6. Exit Criteria for Sprint
- [ ] Zero open P0.
- [ ] No unresolved P1 older than 48 hours.
- [ ] Crash-free session rate at or above target.
- [ ] No new critical regressions introduced by sprint patches.
- [ ] Publish sprint retro with:
  - [ ] Root-cause themes
  - [ ] Preventative follow-up actions
  - [ ] Backlog handoff items
