import React, { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";

export default function Settings() {
  const { users, reloadUsers, toast, system, theme, setTheme } = useApp();
  const [u, setU] = useState({ name: "", email: "", role: "" });
  const [busy, setBusy] = useState(false);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!u.name.trim()) return;
    setBusy(true);
    try {
      await api.post("/users", u);
      setU({ name: "", email: "", role: "" });
      await reloadUsers();
      toast("Team member added");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(id: number, active: boolean) {
    await api.patch(`/users/${id}`, { active });
    await reloadUsers();
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Card title="Team">
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-900 mb-4">
            {users.map((x) => (
              <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-medium">{x.name}</span> <span className="text-neutral-500 text-xs">{[x.role, x.email].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="flex items-center gap-2">
                  {!x.active && <Badge>Inactive</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => toggle(x.id, !x.active)}>
                    {x.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <form onSubmit={addUser} className="grid grid-cols-3 gap-2 items-end">
            <Field label="Name">
              <Input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} />
            </Field>
            <Field label="Role">
              <Input value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })} placeholder="outreach" />
            </Field>
            <Field label="Email">
              <Input value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} />
            </Field>
            <div className="col-span-3 flex justify-end">
              <Button type="submit" variant="primary" loading={busy}>
                Add team member
              </Button>
            </div>
          </form>
          <p className="text-[11px] text-neutral-500 mt-3">This MVP has no login yet: choose who you are working as at the bottom of the sidebar. Every change is recorded against that person in the audit log.</p>
        </Card>
        <div className="space-y-5">
          <Card title="System">
            <dl className="text-sm space-y-2">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Coverage</dt>
                <dd>Bengaluru, Karnataka, India</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Database</dt>
                <dd>{system?.database === "postgres" ? "PostgreSQL + PostGIS" : "Embedded PostgreSQL + PostGIS (PGlite)"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Geocoding</dt>
                <dd>{system?.geocoder === "nominatim" ? "OpenStreetMap Nominatim" : "Off"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">AI extraction & web research</dt>
                <dd>{system?.llm ? `On (${system.llmModel})` : "Off — set GEMINI_API_KEY to enable"}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Appearance">
            <div className="flex gap-2">
              <Button variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>
                Light
              </Button>
              <Button variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>
                Dark
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
