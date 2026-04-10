import { useEffect, useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../../../api";
import { Button } from "../../../ui/primitives";
import { useToast } from "../../../contexts/ToastContext";
import BatchHeaderCard from "./BatchHeaderCard";
import LineTable from "./LineTable";
import ManualMatchModal from "./ManualMatchModal";

export default function BatchDetail({ batchId, onBack }) {
  const toast = useToast();
  const [batch, setBatch] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matchingLine, setMatchingLine] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/fulfillment/cod/settlements/${batchId}`);
      setBatch(data.batch);
      setLines(data.lines || []);
    } catch (err) {
      toast.error(err.message || "Failed to load batch");
    } finally {
      setLoading(false);
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
    await load();
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
        {/* State-dependent action buttons — populated in task 12 */}
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
    </div>
  );
}
