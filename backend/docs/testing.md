# Testing

Run:

```bash
npm test
```

The tests use Jest and Supertest. PostgreSQL with pgvector must be reachable through `DATABASE_URL`, and migrations must be applied first.

OpenAI calls should be mocked in tests that exercise LLM behavior. The current suite avoids live LLM calls except where future route tests should add `jest.mock('openai')`.

Current targeted coverage:

- Memory storage, retrieval, and revision superseding.
- Semantic search ordering.
- Global auth and security-token enforcement.
- Procedural extraction from a 3-step workflow.
- Resource runaway kill detection.
- Red-team approval gate for level 4 and 5 findings.
- Governance kill switch agent termination.
