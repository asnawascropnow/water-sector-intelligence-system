import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Button, ErrorNote, Field, Modal, PotentialBadge, Select, Textarea } from "../ui";

/** Organization → CRM opportunity (Rule 5: only organizations we decide to work on enter the CRM). */
export default function AddToCrmDialog({ org, onClose, stayOnPage }: { org: { id: number; name: string; intelligence?: { potential?: string } } | null; onClose: () => void; stayOnPage?: boolean }) {
  const { activeUsers, currentUser, invalidate, toast } = useApp();
  const navigate = useNavigate();
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setOwner(String(currentUser?.id ?? ""));
      setNotes("");
      setError(null);
    }
  }, [org, currentUser]);

  async function submit() {
    if (!org) return;
    setBusy(true);
    try {
      await api.post("/crm", { organization_id: org.id, owner_id: owner ? Number(owner) : null, notes });
      toast(`${org.name} added to CRM`);
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
          <Field label="Owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why are we pursuing this organization?" />
          </Field>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}
