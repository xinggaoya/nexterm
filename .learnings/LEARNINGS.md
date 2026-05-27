# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260523-001] correction

**Logged**: 2026-05-23T19:20:00+08:00
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
Watcher overload fixes should use generic backpressure, not path-specific dependency-directory rules.

### Details
The first attempted test targeted `node_modules` install bursts too narrowly. The correct requirement is broader: batch installs, generated files, logs, and any high-frequency filesystem activity must be coalesced without special-casing directory names.

### Suggested Action
Prefer event-volume thresholds, root-refresh downgrade, max batch age, and repeated-signature throttling for filesystem watcher overload.

### Metadata
- Source: user_feedback
- Related Files: src-tauri/src/modules/fs/watcher/events.rs
- Tags: watcher, performance, backpressure

---
