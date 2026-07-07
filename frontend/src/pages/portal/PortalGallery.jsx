import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

/**
 * V08 — customer portal photo gallery (proofing).
 *
 * Two-level UI (list → grid, local state, no routing) mirroring PortalTreatments.
 * Client sees only their own client-visible shots, toggles "pick your favourites",
 * and submits the selection. Images are R2-direct URLs served straight from the
 * API response (never proxied). Self-contained — no ui/primitives (portal isolation
 * convention); styled with the Square --ui-* tokens like the other reskinned portal
 * pages (see PortalStays).
 */
export default function PortalGallery() {
  const { tenantSlug } = useParams();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // { id, name }
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await portalApi.get(tenantSlug, "/api/portal/me/projects");
      setProjects(res.projects || []);
    } catch (err) {
      setError(err.message || "Failed to load galleries");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    /* eslint-disable-next-line */
  }, [tenantSlug]);

  async function openGallery(p) {
    setSubmitted(false);
    try {
      const res = await portalApi.get(tenantSlug, `/api/portal/me/projects/${p.id}/gallery`);
      setActive({ id: p.id, name: res.project?.name || p.name });
      setFiles(res.files || []);
    } catch (err) {
      setError(err.message || "Failed to load gallery");
    }
  }

  async function toggle(file) {
    const next = !file.client_selected;
    setFiles((fs) => fs.map((f) => (f.id === file.id ? { ...f, client_selected: next } : f)));
    try {
      await portalApi.put(tenantSlug, `/api/portal/me/projects/${active.id}/gallery/${file.id}`, { selected: next });
    } catch {
      // revert on failure
      setFiles((fs) => fs.map((f) => (f.id === file.id ? { ...f, client_selected: !next } : f)));
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await portalApi.post(tenantSlug, `/api/portal/me/projects/${active.id}/gallery/submit`, {});
      setSubmitted(true);
      loadProjects();
    } catch (err) {
      setError(err.message || "Failed to submit selection");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-(--ui-text-muted)">Loading…</div>;
  if (error) return <div className="text-(--ui-danger-fg)">{error}</div>;

  if (active) {
    const selectedCount = files.filter((f) => f.client_selected).length;
    return (
      <div className="space-y-4">
        <button onClick={() => setActive(null)} className="text-sm font-medium text-(--ui-link) hover:underline">
          ← Back to galleries
        </button>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-(--ui-text)">{active.name}</h1>
          <div className="text-sm text-(--ui-text-muted)">{selectedCount} selected</div>
        </div>
        {files.length === 0 ? (
          <p className="text-(--ui-text-muted)">No photos have been shared yet — check back soon.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => toggle(f)}
                  className={`relative aspect-square overflow-hidden rounded-xl border-2 transition-colors ${
                    f.client_selected ? "border-(--ui-primary)" : "border-transparent hover:border-(--ui-border-strong)"
                  }`}
                >
                  <img src={f.file_url} alt={f.file_name} loading="lazy" className="h-full w-full object-cover" />
                  {f.client_selected && (
                    <span className="absolute top-1 right-1 rounded-full bg-(--ui-primary) text-(--ui-on-primary) text-xs w-6 h-6 flex items-center justify-center">✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={submit}
              disabled={busy}
              className="mt-2 w-full rounded-full bg-(--ui-primary) text-(--ui-on-primary) py-3 font-semibold hover:bg-(--ui-primary-strong) disabled:opacity-60"
            >
              {busy ? "Submitting…" : `Submit ${selectedCount} selection${selectedCount === 1 ? "" : "s"}`}
            </button>
            {submitted && <p className="text-(--ui-success-fg) text-sm">Your selection has been sent to the studio.</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-(--ui-text)">My Gallery</h1>
      {projects.length === 0 ? (
        <p className="text-(--ui-text-muted)">Your photo galleries will appear here once your studio shares them.</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4">
              <div>
                <div className="font-medium text-(--ui-text)">{p.name}</div>
                <div className="text-xs text-(--ui-text-muted)">
                  {p.gallery_count} photo{p.gallery_count === 1 ? "" : "s"}
                  {p.selected_count > 0 ? ` · ${p.selected_count} selected` : ""}
                </div>
              </div>
              <button
                onClick={() => openGallery(p)}
                disabled={!p.gallery_count}
                className="text-sm font-semibold rounded-full px-4 py-1.5 bg-(--ui-primary) text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {p.gallery_count ? "View" : "Pending"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
