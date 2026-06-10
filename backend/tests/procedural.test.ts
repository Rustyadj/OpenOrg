import { extractProcedure } from '../src/services/procedural.js';

describe('procedural extraction', () => {
  test('WorkflowRun with 3 steps extracts procedure fields', () => {
    const proc = extractProcedure({
      name: 'deploy',
      outcome: 'success',
      duration_ms: 120,
      tools_used: ['git', 'docker', 'curl'],
      steps: [
        { tool: 'git', input: {}, output: {}, success: true },
        { tool: 'docker', input: {}, output: {}, success: true },
        { tool: 'curl', input: {}, output: {}, success: true },
      ],
    });

    expect(proc.name).toBe('deploy');
    expect(proc.tool_sequence).toHaveLength(3);
    expect(proc.prerequisites).toContain('Tool available: git');
    expect(proc.validation_steps).toHaveLength(3);
  });
});
