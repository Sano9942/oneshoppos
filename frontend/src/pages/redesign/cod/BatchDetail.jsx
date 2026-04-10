import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../../../api";
import { Button } from "../../../ui/primitives";
import { useToast } from "../../../contexts/ToastContext";
import { useAuth } from "../../../auth/AuthProvider";
import BatchHeaderCard from "./BatchHeaderCard";
import LineTable from "./LineTable";
import ManualMatchModal from "./ManualMatchModal";
import ApproveConfirmModal from "./ApproveConfirmModal";

export default function BatchDetail({ batchId, onBack }) {
  const toast = useToast();
  const { hasPerm } = useAuth();
  const [batch, setBatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matchingLine, setMatchingLine] = useState(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/fulfillment/cod/settlements/${batchId}`);
      if (!mountedRef.current) return;
      setBatch(data.batch);
      setLines(data.lines || []);
    } catch (err) {
      if (!mountedRef.current) return;
      toast.error(err.message || "Failed to load batch");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleResolveNote(lineId, note) {
    try {
      await api.post(`/api/fulfillment/cod/settlements/${batchId}/resolve`, {
        line_id: lineId,
        resolution_note: note,
      });
      toast.success("Note saved");
      await load();
    } catch (err) {
      toast.error(err.message || "Failed to save note");
    }
  }

  function handleManualMatch(line) {
    setMatchingLine(line);
  }

  async function onMatched(lineId, webOrderId) {
    await api.post(`/api/fulfillment/cod/settlements/${batchId}/resolve`, {
      line_id: lineId,
      matched_order_id: webOrderId,
      resolution_note: "Manually matched",
    });
    toast.success("Line matched");
    load().catch(() => {}); // non-blocking — reload failure shouldn't mask match success
  }

  async function runMatch() {
    setRematchBusy(true);
    try {
      await api.post(`/api/fulfillment/cod/settlements/${batchId}/match`, {});
      toast.success("Match re-run");
      await load();
    } catch (err) {
      toast.error(err.message || "Match failed");
    } finally {
      setRematchBusy(false);
    }
  }

  async function confirmApprove() {
    setApproveBusy(true);
    try {
      await api.post(`/api/fulfillment/cod/settlements/${batchId}/approve`, {});
      toast.success("Batch approved");
      setApproveOpen(false);
      await load();
    } catch (err) {
      toast.error(err.message || "Approval failed");
    } finally {
      setApproveBusy(false);
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>;
  }
  if (!batch) {
    return (
      <div className="py-16 text-center">
        <p className="text-(--text-muted) text-sm mb-3">Batch not found</p>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} /> Back to list
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 pt-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} /> Back to list
        </Button>
      </div>

      <BatchHeaderCard batch={batch}>
        {batch.status === "imported" && (
          <Button disabled={rematchBusy} onClick={runMatch}>
            {rematchBusy ? "Matching…" : "Run match"}
          </Button>
        )}
        {batch.status === "matching" && (
          <Button disabled>Matching in progress…</Button>
        )}
        {batch.status === "review" && (
          <>
            <Button variant="ghost" disabled={rematchBusy} onClick={runMatch}>
              {rematchBusy ? "Matching…" : "Re-run match"}
            </Button>
            {hasPerm("all_access") ? (
              <Button onClick={() => setApproveOpen(true)}>Approve batch</Button>
            ) : (
              <Button disabled title="Admin only">
                Approve batch
              </Button>
            )}
          </>
        )}
      </BatchHeaderCard>

      <LineTable
        lines={lines}
        readOnly={batch.status === "approved" || batch.status === "rejected"}
        onResolveNote={handleResolveNote}
        onManualMatch={handleManualMatch}
      />

      <ManualMatchModal
        open={!!matchingLine}
        line={matchingLine}
        onClose={() => setMatchingLine(null)}
        onMatched={onMatched}
      />

      <ApproveConfirmModal
        open={approveOpen}
        batch={batch}
        busy={approveBusy}
        onCancel={() => setApproveOpen(false)}
        onConfirm={confirmApprove}
      />
    </div>
  );
}
