import React, { useEffect, useState } from "react";
import { api } from "../../../api";
import {
  Modal, ModalBody, ModalFooter, Button, Input, Select,
} from "../../../ui/primitives";
import { useToast } from "../../../contexts/ToastContext";

/**
 * Station settings modal (Phase 2-R Wave C / 2-R.5).
 *
 * Lets a manager set the per-station balance_strategy + target_prep_seconds
 * + printer_id. Writes via PUT /api/kds/stations/:id.
 */
export default function KdsStationSettingsModal({ open, onClose, station, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState(station?.name || "");
  const [balanceStrategy, setBalanceStrategy] = useState(station?.balance_strategy || "priority");
  const [targetPrepSeconds, setTargetPrepSeconds] = useState(station?.target_prep_seconds ?? "");
  const [printerId, setPrinterId] = useState(station?.printer_id ?? "");
  const [printers, setPrinters] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(station?.name || "");
    setBalanceStrategy(station?.balance_strategy || "priority");
    setTargetPrepSeconds(station?.target_prep_seconds ?? "");
    setPrinterId(station?.printer_id ?? "");
  }, [station]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await api.get("/api/printer-config");
        setPrinters(Array.isArray(res) ? res : res?.printers || []);
      } catch {
        setPrinters([]);
      }
    })();
  }, [open]);

  async function handleSave() {
    if (!station?.id) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        balance_strategy: balanceStrategy,
        target_prep_seconds: targetPrepSeconds === "" ? null : Number(targetPrepSeconds),
        printer_id: printerId === "" ? null : Number(printerId),
      };
      const updated = await api.put(`/api/kds/stations/${station.id}`, body);
      toast.success("Station updated");
      onSaved?.(updated);
      onClose();
    } catch (err) {
      toast.error(err.message || "Failed to save station");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Station Settings" size="md">
      <ModalBody>
        <label className="block text-sm">
          <span className="text-slate-600">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1" />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Load-balance strategy</span>
          <Select
            value={balanceStrategy}
            onChange={(e) => setBalanceStrategy(e.target.value)}
            className="w-full mt-1"
          >
            <option value="priority">Priority (default — first match wins)</option>
            <option value="round_robin">Round robin (rotate across peers)</option>
            <option value="least_loaded">Least loaded (fewest open tickets; 30s cooldown)</option>
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            Applies when multiple routes match an item at equal priority.
          </p>
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Target prep time (seconds)</span>
          <Input
            type="number"
            min="1"
            value={targetPrepSeconds}
            onChange={(e) => setTargetPrepSeconds(e.target.value)}
            className="w-full mt-1"
            placeholder="Leave empty to skip the delta column"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Fire-chit printer</span>
          <Select
            value={printerId ?? ""}
            onChange={(e) => setPrinterId(e.target.value)}
            className="w-full mt-1"
          >
            <option value="">— None (fall back to default) —</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || `Printer #${p.id}`}
                {p.purpose ? ` (${p.purpose})` : ""}
              </option>
            ))}
          </Select>
        </label>
      </ModalBody>
      <ModalFooter>
        <Button tone="plain" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button tone="primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
