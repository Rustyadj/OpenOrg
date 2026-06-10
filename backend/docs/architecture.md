# Architecture

## Status Labels

- ✅ COMPLETEy: implemented and has targeted tests.
- ⚠️ PARTIAL: implemented, but missing full edge-case coverage, production hardening, or direct tests.
- 🔧 STUBBED: scaffold behavior only.
- 📋 PLANNED: not started.

## Memory Flow

```mermaid
flowchart LR
  Client --> Fastify
  Fastify --> MemoryRoutes
  MemoryRoutes --> Postgres[(PostgreSQL + pgvector)]
  MemoryRoutes --> Search[Vector Similarity Search]
  DreamingJobs --> Postgres
  LearningLoop --> Postgres
  LearningLoop --> Neo4j[(Neo4j)]
```

## Knowledge Graph Schema

```mermaid
graph TD
  Agent -->|WORKS_ON| Project
  Agent -->|HAS_SKILL| Skill
  Agent -->|LEARNED| LearningEvent
  Project -->|PRODUCED| Memory
  Decision -->|RESULTED_IN| Outcome
  Memory -->|SUPERSEDES| Memory
  Memory -->|CONTRADICTS| Memory
  Memory -->|SUPPORTS| Memory
  Person -->|MEMBER_OF| Organization
```

Supported labels are Person, Agent, Project, Decision, Organization, Skill, Outcome, Memory, and LearningEvent.

## Job Scheduler

```mermaid
flowchart TB
  Redis[(Redis)] --> BullMQ
  BullMQ --> Nightly[Nightly 2 AM]
  BullMQ --> Weekly[Weekly Sunday 3 AM]
  Nightly --> Consolidation
  Nightly --> Contradictions
  Nightly --> Duplicates
  Nightly --> Skills
  Nightly --> Goals
  Weekly --> Optimization
  Weekly --> ProcedureBatch
  Weekly --> PerformanceReview
```

## Security Workspace Hierarchy

```mermaid
flowchart LR
  Red[Red Team] --> Findings
  Blue[Blue Team] --> Alerts
  Blue --> IOCs
  Blue --> Incidents
  Purple[Purple Team] --> Retests
  Purple --> Trends
  Findings --> Governance
  Alerts --> Governance
  Governance --> AuditLog
```

## Module Status

| Module | Status | Notes |
| --- | --- | --- |
| `src/services/graph.ts` | ⚠️ PARTIAL | Neo4j integration and constraints implemented; direct route tests not included. |
| `src/routes/graph.ts` | ⚠️ PARTIAL | CRUD-style graph routes implemented; no auth beyond global token. |
| `src/services/procedural.ts` | ✅ COMPLETEy | Deterministic extraction and tests for 3-step workflow. |
| `src/routes/procedural.ts` | ⚠️ PARTIAL | Implemented; route persistence tests not included. |
| `src/services/learning.ts` | ⚠️ PARTIAL | OpenAI extraction implemented; mocked tests not yet added. |
| `src/routes/learning.ts` | ⚠️ PARTIAL | Implemented; route tests not included. |
| `src/jobs/dreaming.ts` | ⚠️ PARTIAL | Jobs and schedules implemented; no integration tests for Redis/BullMQ. |
| `src/routes/dreaming.ts` | ⚠️ PARTIAL | Status and manual trigger implemented. |
| `src/services/selfimprovement.ts` | ⚠️ PARTIAL | Uses `failure_log` as outcome history because no dedicated table exists. |
| `src/routes/selfimprovement.ts` | ⚠️ PARTIAL | Implemented; route tests not included. |
| `src/services/resources.ts` | ⚠️ PARTIAL | Implemented and test written; test could not pass here because PostgreSQL was unreachable. |
| `src/routes/resources.ts` | ⚠️ PARTIAL | Implemented and test written; test could not pass here because PostgreSQL was unreachable. |
| `src/routes/redteam.ts` | ⚠️ PARTIAL | Finding approval gate tested; OpenAI tests require mocks. |
| `src/routes/blueteam.ts` | ⚠️ PARTIAL | Implemented with new log/alert tables; no direct tests. |
| `src/routes/purpleteam.ts` | ⚠️ PARTIAL | Implemented; Redis retest scheduling untested. |
| `src/routes/governance.ts` | ⚠️ PARTIAL | Implemented and test written; test could not pass here because PostgreSQL was unreachable. |
