# Skill Actuators

## Get Active Skill Context

Agents call the actuator before choosing tools or taking an action:

```http
GET /actuator/{agentId}/context?task_context=write%20weekly%20summary&max_tokens=500
```

The response includes `context_block`, formatted for direct system-prompt injection:

```text
[SKILLS: agent-a]
summarize@v1 (90%): Summarize facts in one concise paragraph.
[/SKILLS]
```

## Inject Into A System Prompt

Append `context_block` after the agent identity and before task-specific instructions. Keep the block intact so downstream prompt parsing can identify the active skills.

## Report Outcomes

After the action completes, report whether the skill helped:

```http
POST /actuator/{agentId}/outcome
Content-Type: application/json

{
  "skill_name": "summarize",
  "success": true,
  "feedback": "Produced concise summary without losing dates."
}
```

Repeated regressions automatically create an unapproved proposed skill version for human review.

## Add A Skill Definition

Create a `skill_versions` row with `approved = true` when ready to serve it. Recommended `definition` JSONB fields:

```json
{
  "description": "When to use this skill.",
  "instructions": "One or two direct sentences the agent can follow.",
  "tools": ["optional_tool_name"],
  "constraints": ["Keep output under 200 words."]
}
```

Use `instructions` for the fastest hot path. If `instructions` and `description` are missing, the actuator may call `gpt-4o-mini` to derive concise instructions.
