import React, { useState } from "react";
import { Bot, CalendarCheck, RefreshCw } from "lucide-react";
import type { DailyBrief } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate } from "../lib/format";
import { useApp } from "../context/AppContext";
import RecommendationList from "../components/RecommendationList";
import { TodaysActions } from "./Dashboard";
import { Button, Card, ErrorNote, PageHeader, Select, Spinner } from "../components/ui";

export default function AIRecommendations() {
  const { activeUsers, invalidate, toast } = useApp();
  const [who, setWho] = useState<string>(""); // "" = whole team
  const { data: brief, error, loading } = useApi<DailyBrief>(`/ai/daily-brief${who ? `?user=${who}` : ""}`);
  const [busy, setBusy] = useState(false);

  async function reassessAll() {
    setBusy(true);
    try {
      const r = await api.post<{ assessed: number }>("/ai/assess-all");
      toast(`Opportunity agent re-assessed ${r.assessed} organizations`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const agents = [
    ["Data Extraction Agent", "Turns uploaded Excel, CSV, PDF and Word files into organization records, normalises them and checks for duplicates before human review."],
    ["Organization Enrichment Agent", "Looks up public information (organization website, OpenStreetMap geocoder, and AI web research when configured). Every suggestion keeps its source and waits for approval."],
    ["Opportunity Agent", "Rates each organization's potential for water / Net Zero solutions from its type, sector, water information and location, with reasons. Labelled AI Inference; missing data is never filled in."],
    ["Water opportunity rules", "On request, read a project's or organization's sourced facts and suggest specific water interventions (STP, reuse, rainwater harvesting…), quoting the evidence. Suggestions need a person's approval; only approved ones can go to the CRM."],
    ["Next Action Agent", "Reviews every open CRM opportunity and recommends one next step: assign, contact, follow up on proposals, schedule calls, check pilots."],
    ["Daily Reminder Agent", "Summarises today's follow-ups, calls, proposals awaiting response, new and unassigned opportunities."],
  ];

  return (
    <>
      <PageHeader
        title="AI recommendations"
        subtitle={brief ? `Today's actions · ${formatDate(brief.date, { weekday: "long", day: "numeric", month: "long" })}` : "Today's actions"}
        actions={
          <>
            <Select className="!w-auto" value={who} onChange={(e) => setWho(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: `For ${u.name}` }))} placeholder="For the whole team" aria-label="Recommendations for" />
            <Button onClick={invalidate} loading={loading}>
              <RefreshCw size={13} /> Refresh
            </Button>
            <Button onClick={reassessAll} loading={busy}>
              Re-assess all organizations
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />
      {!brief ? (
        <Spinner />
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <section className="min-w-0">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold">Recommendations</h2>
              <span className="text-xs text-[var(--text-3)]">{brief.recommendations.length} open · highest priority first</span>
            </div>
            <RecommendationList items={brief.recommendations} />
          </section>
          <div className="space-y-6 lg:sticky lg:top-6">
            <Card icon={CalendarCheck} title="Today's actions" bodyClassName="px-5 py-3">
              <TodaysActions brief={brief} />
            </Card>
            <Card icon={Bot} title="How the agents work">
              <dl className="space-y-3 text-sm">
                {agents.map(([n, d]) => (
                  <div key={n}>
                    <dt className="font-medium">{n}</dt>
                    <dd className="text-[var(--text-2)] text-xs mt-0.5">{d}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[11px] text-[var(--text-3)] mt-3">Agents never contact organizations. All outreach is done by the team.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
