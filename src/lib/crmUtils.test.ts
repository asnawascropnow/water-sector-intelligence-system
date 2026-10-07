import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pipeline } from "../../shared/types";
import { boardColumns, crmQuery, EMPTY_CRM_FILTERS, findPipeline, neighbourStage, opportunityTitle, splitOpportunities, stageKind } from "./crmUtils";

// Shaped like GET /api/meta → pipelines (the UI never hard-codes them).
const stage = (name: string, sort_order: number, kind: "open" | "won" | "lost" = "open", is_outcome = false) => ({ name, sort_order, kind, is_outcome, milestone: null });
const pipelines: Pipeline[] = [
  {
    key: "relationship", label: "Organization / Relationship", description: null, is_default: true,
    stages: [stage("Nurture", 100, "open", true), stage("New", 10), stage("Contacted", 20), stage("Converted", 70, "won"), stage("Lost", 90, "lost", true)],
  },
  { key: "project", label: "Project Opportunity", description: null, is_default: false, stages: [stage("Identified", 10), stage("Research", 20), stage("Won", 90, "won"), stage("Lost", 100, "lost", true)] },
];

test("board columns come from the catalog: main track in order, outcomes separately", () => {
  assert.deepEqual(boardColumns(pipelines[0]).main.map((s) => s.name), ["New", "Contacted", "Converted"]);
  assert.deepEqual(boardColumns(pipelines[0]).outcomes.map((s) => s.name), ["Lost", "Nurture"]);
  assert.deepEqual(boardColumns(pipelines[1]).main.map((s) => s.name), ["Identified", "Research", "Won"]);
  assert.deepEqual(boardColumns(undefined), { main: [], outcomes: [] });
  assert.equal(findPipeline(pipelines, "project")?.key, "project");
  assert.equal(findPipeline(pipelines, "nope")?.key, "relationship", "falls back to the default pipeline");
});

test("stage neighbours stay within the opportunity's own pipeline", () => {
  assert.equal(neighbourStage(pipelines[1], "Identified", 1), "Research");
  assert.equal(neighbourStage(pipelines[1], "Identified", -1), null);
  assert.equal(neighbourStage(pipelines[1], "Won", 1), null);
  assert.equal(neighbourStage(pipelines[1], "Contacted", 1), null, "a relationship stage is not a project stage");
  assert.equal(neighbourStage(pipelines[0], "Nurture", 1), null, "outcomes have no next stage");
  assert.equal(stageKind(pipelines[1], "Won"), "won");
});

test("CRM query: filters combine and are sent to the server; lifecycle only for project opportunities", () => {
  assert.equal(crmQuery("relationship", EMPTY_CRM_FILTERS), "?pipeline=relationship");
  const f = { ...EMPTY_CRM_FILTERS, q: " stp ", owner: "2", intervention: "STP", lifecycle: "Design", potential: "High" };
  assert.equal(crmQuery("project", f), "?pipeline=project&q=stp&owner=2&potential=High&intervention=STP&lifecycle=Design");
  assert.ok(!crmQuery("relationship", f).includes("lifecycle"));
});

test("titles and the relationship / project split", () => {
  assert.equal(opportunityTitle({ title: null, opportunity_type: "Project Opportunity", project_name: "Lakeside", pipeline: "project" }), "Project Opportunity — Lakeside");
  assert.equal(opportunityTitle({ title: "STP retrofit", opportunity_type: "Customer", project_name: null, pipeline: "relationship" }), "STP retrofit");
  const s = splitOpportunities([{ pipeline: "relationship" }, { pipeline: "project" }, { pipeline: "relationship" }]);
  assert.deepEqual([s.relationship.length, s.project.length], [2, 1]);
});
