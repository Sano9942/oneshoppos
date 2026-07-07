import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

/**
 * V08 — customer portal photo gallery (proofing).
 *
 * Two-level UI (list → grid, local state, no routing) mirroring PortalTreatments.
 * Client sees only their own client-visible shots, toggles "pick your favourites",
 * and submits the selection. Images are R2-direct URLs served straight from the
 * API response (never proxied). Self-contained inline Tailwind — no ui/primitives
 * (portal isolation convention).
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

  if (loading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  if (active) {
    const selectedCount = files.filter((f) => f.client_selected).length;
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => setActive(null)} className="text-sm text-blue-600 mb-4">
          ← Back to galleries
        </button>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">{active.name}</h1>
          <div className="text-sm text-slate-500">{selectedCount} selected</div>
        </div>
        {files.length === 0 ? (
          <p className="text-slate-500">No photos have been shared yet — check back soon.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => toggle(f)}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                    f.client_selected ? "border-emerald-500" : "border-transparent"
                  }`}
                >
                  <img src={f.file_url} alt={f.file_name} loading="lazy" className="h-full w-full object-cover" />
                  {f.client_selected && (
                    <span className="absolute top-1 right-1 rounded-full bg-emerald-500 text-white text-xs w-6 h-6 flex items-center justify-center">✓</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={submit}
              disabled={busy}
              className="mt-6 w-full rounded-lg bg-emerald-600 text-white py-3 font-semibold disabled:opacity-60"
            >
              {busy ? "Submitting…" : `Submit ${selectedCount} selection${selectedCount === 1 ? "" : "s"}`}
            </button>
            {submitted && <p className="text-emerald-600 text-sm mt-3">Your selection has been sent to the studio.</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">My Gallery</h1>
      {projects.length === 0 ? (
        <p className="text-slate-500">Your photo galleries will appear here once your studio shares them.</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {p.gallery_count} photo{p.gallery_count === 1 ? "" : "s"}
                  {p.selected_count > 0 ? ` · ${p.selected_count} selected` : ""}
                </div>
              </div>
              <button
                onClick={() => openGallery(p)}
                disabled={!p.gallery_count}
                className="text-sm font-semibold rounded px-3 py-1.5 bg-emerald-600 text-white disabled:opacity-40"
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
