import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./primitives";
import { useToast } from "../contexts/ToastContext";
import { api } from "../api";

const MAX_FILES = 3;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("bug");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);
  const { success, error } = useToast();

  // Create stable object URLs and revoke them on change/unmount
  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [previewUrls]);

  function handleFiles(e) {
    const selected = Array.from(e.target.files || []);
    const valid = [];
    for (const f of selected) {
      if (files.length + valid.length >= MAX_FILES) {
        error(`Maximum ${MAX_FILES} screenshots allowed`);
        break;
      }
      if (f.size > MAX_SIZE) {
        error(`${f.name} exceeds 5 MB limit`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length) setFiles((prev) => [...prev, ...valid]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setType("bug");
    setMessage("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) {
      error("Please describe the issue");
      return;
    }

    setLoading(true);
    try {
      // Upload screenshots first
      const screenshots = [];
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          const res = await api.upload("/api/support/upload", fd);
          if (res.ok) {
            const data = await res.json();
            screenshots.push({ filename: data.filename, url: data.url });
          }
        } catch {
          // If one upload fails, continue with the rest
        }
      }

      // Submit the ticket
      await api.post("/api/support/tickets", {
        type,
        message: message.trim(),
        page_url: window.location.pathname,
        browser: navigator.userAgent,
        screenshots,
        last_req_id: window.__lastFailedReqId || null,
      });

      // Clear stale request ID
      window.__lastFailedReqId = null;

      success("Support ticket submitted — thank you!");
      resetForm();
      setOpen(false);
    } catch {
      error("Could not submit ticket. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-(--ui-primary) text-white shadow-(--ui-shadow-lg) transition hover:bg-(--ui-primary-strong)"
        aria-label="Support"
      >
        <span className="text-lg font-bold">?</span>
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[350px] rounded-lg border border-(--ui-border) bg-(--ui-surface) shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-(--ui-border) px-4 py-3">
            <h3 className="text-sm font-semibold text-(--ui-text)">Report an Issue</h3>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3 p-4">
            {/* Type */}
            <div>
              <label htmlFor="support-ticket-type" className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Type</label>
              <select
                id="support-ticket-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text)"
              >
                <option value="bug">Bug</option>
                <option value="feature_request">Feature Request</option>
                <option value="question">Question</option>
              </select>
            </div>

            {/* Message */}
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue..."
                rows={4}
                required
                className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) resize-none"
              />
            </div>

            {/* Screenshots */}
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                Attach screenshots ({files.length}/{MAX_FILES})
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFiles}
                className="block w-full text-xs text-(--ui-text-muted) file:mr-2 file:cursor-pointer file:rounded-full file:border-0 file:bg-(--ui-muted-surface) file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-(--ui-text)"
              />
              {files.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {files.map((f, i) => (
                    <div key={i} className="relative">
                      <img
                        src={previewUrls[i]}
                        alt={f.name}
                        className="h-14 w-14 rounded border border-(--ui-border) object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white cursor-pointer"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            <Button
              type="submit"
              tone="primary"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
