import { useState, useEffect } from "react";
import { History, Search, RefreshCcw } from "lucide-react";

import { API_BASE as API } from '../config';


const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

export default function ActionHistory() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchLogs = async (q = "") => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${API}/api/action-history?search=${encodeURIComponent(q)}`,
      );
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      console.error("Failed to load action history");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchLogs(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Action History
          </h1>
          <p className="text-slate-500">
            Audit log of system actions and events.
          </p>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden min-h-0">
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div className="relative max-w-sm w-full">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <input
                type="text"
                placeholder="Search user, action, or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-linear-to-br from-slate-100 to-slate-50 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <button
              onClick={() => fetchLogs(search)}
              className="p-2 text-slate-400 hover:text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm"
            >
              <RefreshCcw size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                  <th className="p-4 w-48">Timestamp</th>
                  <th className="p-4 w-48">User</th>
                  <th className="p-4 w-64">Action</th>
                  <th className="p-4">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="4" className="p-8 text-center text-slate-400">
                      Loading history logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="p-10 text-center">
                      <History
                        size={48}
                        className="mx-auto text-slate-300 mb-3"
                      />
                      <p className="font-medium text-slate-600">
                        No logs found
                      </p>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="p-4 text-xs font-medium text-slate-500 font-mono">
                        {fmtDate(log.timestamp)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {log.user_name?.charAt(0).toUpperCase() || "?"}
                          </div>
                          <span className="font-semibold text-slate-800 text-sm">
                            {log.user_name || "System"}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs font-bold tracking-wide">
                          {log.action_type}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {log.description}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
