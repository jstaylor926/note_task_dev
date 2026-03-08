# Private Beta Onboarding Workflow

> Track: `production_ai_beta_90d`  
> Target cohort: 20-100 users  
> Audience: local-first developers, mixed macOS/Linux/Windows environments.

## 1. Cohort Selection
- [ ] Define initial cohort size (start with 20-30 users for wave 1).
- [ ] Ensure platform mix is represented:
  - [ ] macOS
  - [ ] Linux
  - [ ] Windows
- [ ] Ensure use-case mix is represented:
  - [ ] Solo coding projects
  - [ ] Multi-repo workflows
  - [ ] Heavy terminal users

## 2. Invite Packet
- [ ] Prepare invite template with:
  - [ ] Beta goals and expected instability disclaimer.
  - [ ] Install instructions by OS.
  - [ ] Feedback expectations and response SLA.
  - [ ] Data/privacy summary (local-first + cloud opt-in).
- [ ] Include quick start checklist:
  - [ ] Create/open workspace profile.
  - [ ] Verify indexing starts.
  - [ ] Run one search and one chat session.
  - [ ] Export diagnostics once and keep file.

## 3. Enrollment Steps
- [ ] Create beta cohort roster with unique participant ID.
- [ ] Issue install link + `beta` channel instructions.
- [ ] Collect baseline metadata:
  - [ ] OS/version
  - [ ] Hardware class (CPU/RAM)
  - [ ] Repo size bucket
  - [ ] Preferred model path (local-only vs opt-in cloud)
- [ ] Confirm first-run readiness:
  - [ ] App launches
  - [ ] Sidecar healthy
  - [ ] Session handoff available

## 4. Feedback Intake and Triage
- [ ] Route all in-app feedback to issue tracker with trace ID.
- [ ] Label schema:
  - [ ] `beta-crash`
  - [ ] `beta-ai-quality`
  - [ ] `beta-performance`
  - [ ] `beta-ux`
  - [ ] `beta-security`
- [ ] Triage SLA:
  - [ ] P0/P1 within same day
  - [ ] P2 within 48 hours
  - [ ] P3 weekly

## 5. Weekly Beta Cadence
- [ ] Weekly bug scrub with ranked top regressions.
- [ ] Weekly release note to cohort with:
  - [ ] Fixed issues
  - [ ] Known issues
  - [ ] Requested validation scenarios
- [ ] Weekly KPI review:
  - [ ] Crash-free session rate
  - [ ] Search latency p95
  - [ ] Session synthesis latency p95
  - [ ] AI fallback success rate

## 6. Exit from Beta Wave 1
- [ ] Verify no open P0/P1 issues.
- [ ] Meet crash/perf minimum thresholds.
- [ ] Confirm highest-frequency UX blockers have mitigation plan.
- [ ] Decide whether to expand cohort size for wave 2.
