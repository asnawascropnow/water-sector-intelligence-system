import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import type { EmailSystemStatus, SequenceStep, TestRecipientStatus } from "../../../shared/email";
import { api } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Button, Card, ErrorNote, Field, Input, Select } from "../ui";

/**
 * Send one test email for a step. The server decides who may receive tests (team members' addresses and
 * EMAIL_TEST_RECIPIENTS); this card asks it first so the user sees why an address is refused before sending.
 * Only one request runs at a time, and a failure is shown once, inline, instead of as repeated toasts.
 */
export default function TestEmailCard({ campaignId, steps, status }: { campaignId: number; steps: SequenceStep[]; status: EmailSystemStatus | null }) {
  const { toast, currentUser } = useApp();
  const [to, setTo] = useState(currentUser?.email ?? status?.test_recipients.find((r) => !r.startsWith("@")) ?? "");
  const [stepId, setStepId] = useState(steps[0] ? String(steps[0].id) : "");
  const [check, setCheck] = useState<TestRecipientStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false); // guards against double clicks before React re-renders the disabled button
  const can = !!status?.can_approve;

  useEffect(() => {
    if (!steps.some((s) => String(s.id) === stepId)) setStepId(steps[0] ? String(steps[0].id) : "");
  }, [steps, stepId]);

  // Ask the server whether the address may receive test emails (debounced).
  useEffect(() => {
    setError(null);
    const value = to.trim();
    if (!value) {
      setCheck(null);
      return;
    }
    let live = true;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .get<TestRecipientStatus>(`/email/test-recipient?to=${encodeURIComponent(value)}`)
        .then((r) => live && setCheck(r))
        .catch((e) => live && setCheck({ email: null, authorized: false, via: null, reason: (e as Error).message }))
        .finally(() => live && setChecking(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [to]);

  async function send() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await api.post(`/email/campaigns/${campaignId}/test-email`, { step_id: Number(stepId), to: to.trim() });
      toast(status?.mode === "dry_run" ? `Test recorded for ${to.trim()} (dry run — nothing was delivered)` : `Test email sent to ${to.trim()}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const blocked = !can || !stepId || !to.trim() || checking || !check?.authorized;
  return (
    <Card icon={Send} title="Send a test email" description={status?.mode === "dry_run" ? "Dry-run mode: recorded, not delivered" : "Delivered for real, subject prefixed [TEST]"}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Step">
          <Select value={stepId} onChange={(e) => setStepId(e.target.value)} options={steps.map((s) => ({ value: s.id, label: `Step ${s.step_order}: ${s.subject_template.slice(0, 40)}` }))} />
        </Field>
        <Field label="To">
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" aria-describedby="test-recipient-status" />
        </Field>
      </div>
      <div id="test-recipient-status" className="mt-2 text-xs min-h-4" aria-live="polite">
        {!to.trim() ? (
          <span className="text-[var(--text-3)]">Test emails can go to a team member's address (Settings → Team) or an address in the server's EMAIL_TEST_RECIPIENTS.</span>
        ) : checking || !check ? (
          <span className="text-[var(--text-3)]">Checking recipient…</span>
        ) : check.authorized ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={13} /> {check.reason}
          </span>
        ) : (
          <span className="inline-flex items-start gap-1 text-red-700 dark:text-red-300">
            <XCircle size={13} className="mt-px shrink-0" /> {check.reason}
          </span>
        )}
      </div>
      {!can && <p className="text-xs text-[var(--text-3)] mt-1">Only team members with role {status?.approver_roles.join(" or ")} can send test emails.</p>}
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
      <div className="flex justify-end">
        <Button disabled={blocked} loading={sending} title={!can ? "Approvers only" : undefined} onClick={send}>
          <Send size={14} /> {sending ? "Sending…" : "Send test"}
        </Button>
      </div>
    </Card>
  );
}
