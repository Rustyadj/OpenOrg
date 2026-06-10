# Limitations

- ⚠️ `src/jobs/dreaming.ts` implements Redis schedules, but queue behavior is not covered by integration tests.
- ⚠️ Learning extraction depends on OpenAI JSON output and needs stricter schema validation.
- ⚠️ Self-improvement outcome history is stored inside `skill_versions.failure_log`; a dedicated event table would be cleaner.
- ⚠️ Resource runaway detection uses aggregate `tokens_used`; the schema does not support a real 60-second token window.
- ⚠️ Graph objects return raw Neo4j driver shapes rather than normalized API DTOs.
- ⚠️ Red-team model comparison and adversarial judging are implemented but not deeply validated.
- ⚠️ Blue-team alert/log tables were added in `002_security_logs_alerts.sql`; existing deployments must apply it.
- ⚠️ Security-token auth is route-level only for security workspaces; broader RBAC is not implemented.
- 🔧 Memory poisoning test endpoint uses basic heuristic validation instead of exercising the real memory write route.
