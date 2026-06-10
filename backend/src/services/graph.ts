import neo4j, { Driver } from 'neo4j-driver';

const labels = ['Person', 'Agent', 'Project', 'Decision', 'Organization', 'Skill', 'Outcome', 'Memory', 'LearningEvent'] as const;
const relationshipTypes = ['WORKS_ON', 'RESULTED_IN', 'HAS_SKILL', 'PRODUCED', 'MEMBER_OF', 'SUPERSEDES', 'CONTRADICTS', 'SUPPORTS', 'LEARNED'] as const;

export type NodeLabel = (typeof labels)[number];
export type RelationshipType = (typeof relationshipTypes)[number];

let driver: Driver | null = null;

function assertLabel(label: string): asserts label is NodeLabel {
  if (!labels.includes(label as NodeLabel)) throw new Error(`Unsupported Neo4j label: ${label}`);
}

function assertRelationshipType(type: string): asserts type is RelationshipType {
  if (!relationshipTypes.includes(type as RelationshipType)) throw new Error(`Unsupported relationship type: ${type}`);
}

export function getDriver() {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'openclaw'),
    );
  }
  return driver;
}

export async function initNeo4j() {
  const session = getDriver().session();
  try {
    for (const label of labels) {
      await session.run(`CREATE CONSTRAINT ${label.toLowerCase()}_id_unique IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`);
    }
  } finally {
    await session.close();
  }
}

export async function createRelationship(from: string, fromLabel: string, to: string, toLabel: string, relType: string, props: object = {}) {
  assertLabel(fromLabel);
  assertLabel(toLabel);
  assertRelationshipType(relType);
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MERGE (a:${fromLabel} {id: $from})
       MERGE (b:${toLabel} {id: $to})
       MERGE (a)-[r:${relType}]->(b)
       SET r += $props, r.updated_at = datetime()
       RETURN a, r, b`,
      { from, to, props },
    );
    return result.records[0]?.toObject() ?? null;
  } finally {
    await session.close();
  }
}

export async function deleteRelationship(from: string, to: string, relType: string) {
  assertRelationshipType(relType);
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (a {id: $from})-[r:${relType}]->(b {id: $to})
       DELETE r
       RETURN count(r) AS deleted`,
      { from, to },
    );
    return Number(result.records[0]?.get('deleted') ?? 0);
  } finally {
    await session.close();
  }
}

export async function getSubgraph(nodeId: string, depth = 2) {
  const boundedDepth = Math.min(Math.max(Number(depth) || 2, 1), 5);
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH p=(n {id: $nodeId})-[*0..${boundedDepth}]-(m)
       UNWIND nodes(p) AS node
       UNWIND relationships(p) AS rel
       RETURN collect(DISTINCT node) AS nodes, collect(DISTINCT rel) AS relationships`,
      { nodeId },
    );
    const record = result.records[0];
    return {
      nodes: record?.get('nodes') ?? [],
      relationships: record?.get('relationships') ?? [],
    };
  } finally {
    await session.close();
  }
}

export async function findRelated(nodeId: string, relType?: string) {
  const session = getDriver().session();
  const relPattern = relType ? `:${relType}` : '';
  if (relType) assertRelationshipType(relType);
  try {
    const result = await session.run(
      `MATCH (n {id: $nodeId})-[r${relPattern}]-(related)
       RETURN related, type(r) AS relationship_type, startNode(r).id AS from, endNode(r).id AS to`,
      { nodeId },
    );
    return result.records.map((record) => record.toObject());
  } finally {
    await session.close();
  }
}
