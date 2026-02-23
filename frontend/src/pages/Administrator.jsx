import React, { useState, useEffect } from "react";
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Key,
  Users,
  Check,
  X,
  Save,
} from "lucide-react";

const API = "http://localhost:5000/api";

const AVAILABLE_PERMISSIONS = [
  { id: "all_access", label: "All Access", category: "System" },
  { id: "manage_inventory", label: "Manage Inventory", category: "Inventory" },
  { id: "view_reports", label: "View Reports", category: "Reporting" },
  { id: "manage_employees", label: "Manage Employees", category: "System" },
  { id: "pos_discount", label: "Apply Custom Discounts", category: "POS" },
  { id: "pos_void", label: "Void Sales", category: "POS" },
  { id: "pos_park", label: "Park & Restore Sales", category: "POS" },
];

export default function Administrator() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);

  // Form State
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [rolePermissions, setRolePermissions] = useState([]); // array of permission strings

  const isDefaultRole = (id) => ["1", "2", "3"].includes(id?.toString());

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/roles`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Fetch permissions for each role concurrently
      const rolesWithPerms = await Promise.all(
        data.roles.map(async (role) => {
          const permRes = await fetch(`${API}/roles/${role.id}/permissions`);
          const permData = await permRes.json();
          return { ...role, permissions: permData.permissions || [] };
        }),
      );

      setRoles(rolesWithPerms);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openModal = (role = null) => {
    if (role) {
      setEditingRole(role);
      setFormData({ name: role.name, description: role.description || "" });
      setRolePermissions(role.permissions || []);
    } else {
      setEditingRole(null);
      setFormData({ name: "", description: "" });
      setRolePermissions([]);
    }
    setError(null);
    setIsModalOpen(true);
  };

  const handleTogglePermission = (permId) => {
    if (rolePermissions.includes("all_access") && permId !== "all_access")
      return; // If all access is checked, ignore others

    setRolePermissions((prev) => {
      if (permId === "all_access") {
        return prev.includes("all_access") ? [] : ["all_access"];
      }
      return prev.includes(permId)
        ? prev.filter((p) => p !== permId)
        : [...prev, permId];
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name) return setError("Role name is required");

    setError(null);
    setLoading(true);

    try {
      // 1. Save Role
      const url = editingRole
        ? `${API}/roles/${editingRole.id}`
        : `${API}/roles`;
      const method = editingRole ? "PUT" : "POST";

      const roleRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const roleData = await roleRes.json();
      if (!roleRes.ok) throw new Error(roleData.error);

      const roleId = editingRole ? editingRole.id : roleData.id;

      // 2. Save Permissions
      const permRes = await fetch(`${API}/roles/${roleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: rolePermissions }),
      });
      const permData = await permRes.json();
      if (!permRes.ok) throw new Error(permData.error);

      await fetchRoles();
      setIsModalOpen(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this role?")) return;
    try {
      const res = await fetch(`${API}/roles/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      fetchRoles();
    } catch (err) {
      alert(err.message);
    }
  };

  // Group permissions by category for UI
  const groupedPermissions = AVAILABLE_PERMISSIONS.reduce((acc, perm) => {
    acc[perm.category] = acc[perm.category] || [];
    acc[perm.category].push(perm);
    return acc;
  }, {});

  return (
    <div className="w-full flex flex-col h-full space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-800">
            <Shield className="text-indigo-600" size={28} />
            Role & Permission Management
          </h1>
          <p className="text-slate-500 mt-1">
            Configure system access levels and assign permissions to roles.
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-md shadow-indigo-200 transition-all flex items-center gap-2"
        >
          <Plus size={18} /> Add Role
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-0">
        {roles.map((role) => (
          <div
            key={role.id}
            className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden hover:shadow-md transition-shadow"
          >
            <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-slate-50">
              <div>
                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                  {role.name}
                  {isDefaultRole(role.id) && (
                    <span className="bg-slate-200 text-slate-600 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full">
                      System
                    </span>
                  )}
                </h3>
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                  {role.description || "No description"}
                </p>
              </div>
            </div>

            <div className="p-5 flex-1 relative">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
                Permissions ({role.permissions.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {role.permissions.includes("all_access") ? (
                  <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <Check size={12} /> All Access
                  </span>
                ) : role.permissions.length > 0 ? (
                  role.permissions.slice(0, 5).map((p) => (
                    <span
                      key={p}
                      className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-medium"
                    >
                      {AVAILABLE_PERMISSIONS.find((ap) => ap.id === p)?.label ||
                        p}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 text-sm italic">
                    No special permissions assigned
                  </span>
                )}
                {role.permissions.length > 5 &&
                  !role.permissions.includes("all_access") && (
                    <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-xs font-medium">
                      +{role.permissions.length - 5} more
                    </span>
                  )}
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => openModal(role)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Edit size={14} /> Edit
              </button>
              {!isDefaultRole(role.id) && (
                <button
                  onClick={() => handleDelete(role.id)}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Key className="text-indigo-600" size={20} />
                {editingRole ? "Edit Role & Permissions" : "Create New Role"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="p-6 overflow-y-auto min-h-0 space-y-6">
                {error && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Role Name *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={editingRole && isDefaultRole(editingRole.id)}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="e.g., Assistant Manager"
                    />
                    {editingRole && isDefaultRole(editingRole.id) && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <Shield size={10} /> Default system role names cannot be
                        changed.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none text-slate-800"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Brief summary of duties..."
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold text-slate-800">
                      Access Permissions
                    </h3>
                    {rolePermissions.includes("all_access") && (
                      <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-1 rounded">
                        Full Administrator Access Granted
                      </span>
                    )}
                  </div>

                  <div className="space-y-6">
                    {/* Special Full Access Toggle */}
                    <div
                      onClick={() => handleTogglePermission("all_access")}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between ${rolePermissions.includes("all_access") ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-200"}`}
                    >
                      <div>
                        <h4
                          className={`font-bold ${rolePermissions.includes("all_access") ? "text-emerald-800" : "text-slate-800"}`}
                        >
                          All Access (Admin)
                        </h4>
                        <p
                          className={`text-sm ${rolePermissions.includes("all_access") ? "text-emerald-600" : "text-slate-500"}`}
                        >
                          Grant total access to every feature in the
                          application.
                        </p>
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${rolePermissions.includes("all_access") ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300"}`}
                      >
                        {rolePermissions.includes("all_access") && (
                          <Check size={14} className="stroke-3" />
                        )}
                      </div>
                    </div>

                    {!rolePermissions.includes("all_access") &&
                      Object.entries(groupedPermissions).map(
                        ([category, perms]) => (
                          <div
                            key={category}
                            className="bg-slate-50 border border-slate-200 p-4 rounded-xl"
                          >
                            <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider mb-3">
                              {category}
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {perms.map((p) => (
                                <div
                                  key={p.id}
                                  onClick={() => handleTogglePermission(p.id)}
                                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${rolePermissions.includes(p.id) ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200 hover:border-indigo-100"}`}
                                >
                                  <div
                                    className={`w-5 h-5 rounded flex items-center justify-center border ${rolePermissions.includes(p.id) ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 bg-white"}`}
                                  >
                                    {rolePermissions.includes(p.id) && (
                                      <Check size={12} className="stroke-3" />
                                    )}
                                  </div>
                                  <span
                                    className={`text-sm font-medium select-none ${rolePermissions.includes(p.id) ? "text-indigo-900" : "text-slate-700"}`}
                                  >
                                    {p.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium shadow-md shadow-indigo-200 transition-all flex items-center gap-2 disabled:opacity-70"
                >
                  <Save size={18} />
                  {loading ? "Saving..." : "Save Role"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
