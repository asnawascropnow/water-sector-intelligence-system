import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { POTENTIAL_LEVELS } from "../../../shared/constants";
import { Button, ErrorNote, Field, Input, Modal, PotentialBadge, Select, Textarea } from "../ui";

/**
 * Organization → CRM opportunity in the Organization / Relationship pipeline (Rule 5: only organizations we
 * decide to work on enter the CRM). The default is exactly the MVP flow (a Customer opportunity); a different
 * relationship type (Architect Partner, Developer Relationship…) can be chosen for a second relationship.
 * Project opportunities are created from the project, never here.
 */
export default function AddToCrmDialog({ org, onClose, stayOnPage }: { org: { id: number; name: string; intelligence?: { potential?: string } } | null; onClose: () => void; stayOnPage?: boolean }) {
  const { activeUsers, currentUser, catalog, invalidate, toast } = useApp();
  const navigate = useNavigate();
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");
  const [type, setType] = useState("Customer");
  const [title, setTitle] = useState("");
  const [potential, setPotential] = useState("");
  const types = (catalog?.opportunityTypes ?? []).filter((t) => t.default_pipeline === "relationship").map((t) => t.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setOwner(String(currentUser?.id ?? ""));
      setNotes("");
      setType("Customer");
      setTitle("");
      setPotential("");
      setError(null);
    }
  }, [org, currentUser]);

  async function submit() {
    if (!org) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { organization_id: org.id, owner_id: owner ? Number(owner) : null, notes };
      if (type !== "Customer") body.opportunity_type = type;
      if (title.trim()) body.title = title.trim();
      if (potential) body.potential = potential;
      await api.post("/crm", body);
      toast(`${org.name} added to CRM${type !== "Customer" ? ` (${type})` : ""}`);
      invalidate();
      onClose();
      if (!stayOnPage) navigate(`/organizations/${org.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(org)}
      onClose={onClose}
      title="Add to CRM"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Add to CRM
          </Button>
        </>
      }
    >
      {org && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">{org.name}</div>
            <PotentialBadge potential={org.intelligence?.potential} />
          </div>
          <p className="text-xs text-[var(--text-3)]">Organization / Relationship pipeline. Project opportunities are created from the project's CRM tab.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Relationship type">
              <Select value={type} onChange={(e) => setType(e.target.value)} options={types.length ? types : ["Customer"]} aria-label="Relationship type" />
            </Field>
            <Field label="Owner">
              <Select value={owner} onChange={(e) => setOwner(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" />
            </Field>
            <Field label="Title (optional)">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Architect partnership" />
            </Field>
            <Field label="Potential" hint="Your rating">
              <Select value={potential} onChange={(e) => setPotential(e.target.value)} options={POTENTIAL_LEVELS} placeholder="Not rated" aria-label="Potential" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why are we pursuing this organization?" />
          </Field>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
