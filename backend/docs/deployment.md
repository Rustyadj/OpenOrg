# Deployment

## Production Checklist

- Apply `migrations/001_init.sql` and `migrations/002_security_logs_alerts.sql`.
- Confirm `DATABASE_URL`, `NEO4J_URI`, `REDIS_URL`, `OPENAI_API_KEY`, `AUTH_TOKEN`, and `SECURITY_TOKEN` are injected securely.
- Run `npm run build`.
- Run `npm test` against a disposable database before promoting.
- Configure process supervision for `npm start`.
- Ensure Redis persistence and BullMQ retry behavior match operational requirements.
- Restrict Neo4j and PostgreSQL network access to trusted hosts.
- Rotate `SECURITY_TOKEN` and `AUTH_TOKEN` regularly.
- Monitor `audit_log`, BullMQ failures, and resource-manager kill events.
