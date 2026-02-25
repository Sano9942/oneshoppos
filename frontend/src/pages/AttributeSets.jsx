import { API_BASE as API } from '../config';
import { useState, useEffect } from "react";
import {
  Tags,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  AlertCircle,
} from "lucide-react";

export default function AttributeSets() {
  const [sets, setSets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSet, setEditingSet] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    attributes: [{ name: "", options: [] }],
  });

  // Tag input temp state
  const [currentOptionInput, setCurrentOptionInput] = useState({});

  useEffect(() => {
    fetchSets();
  }, []);

  const fetchSets = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${API}/api/attribute-sets`);
      const data = await res.json();
      setSets(data.attributeSets || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load attribute sets.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenModal = (set = null) => {
    if (set) {
      setEditingSet(set);
      setFormData({
        name: set.name,
        description: set.description || "",
        attributes: set.attributes?.length > 0
          ? set.attributes.map((a) => ({
              name: a.name,
              options: a.options.map((o) => o.value),
            }))
          : [{ name: "", options: [] }],
      });
    } else {
      setEditingSet(null);
      setFormData({
        name: "",
        description: "",
        attributes: [{ name: "", options: [] }],
      });
    }
    setCurrentOptionInput({});
    setIsModalOpen(true);
  };

  const addAttribute = () => {
    setFormData((prev) => ({
      ...prev,
      attributes: [...prev.attributes, { name: "", options: [] }],
    }));
  };

  const removeAttribute = (index) => {
    setFormData((prev) => ({
      ...prev,
      attributes: prev.attributes.filter((_, i) => i !== index),
    }));
  };

  const updateAttributeName = (index, name) => {
    const newAttrs = [...formData.attributes];
    newAttrs[index].name = name;
    setFormData({ ...formData, attributes: newAttrs });
  };

  const handleOptionInputKeyDown = (e, attrIndex) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = (currentOptionInput[attrIndex] || "").trim();
      if (val && !formData.attributes[attrIndex].options.includes(val)) {
        const newAttrs = [...formData.attributes];
        newAttrs[attrIndex].options.push(val);
        setFormData({ ...formData, attributes: newAttrs });
        setCurrentOptionInput({ ...currentOptionInput, [attrIndex]: "" });
      }
    }
  };

  const removeOption = (attrIndex, optIndex) => {
    const newAttrs = [...formData.attributes];
    newAttrs[attrIndex].options.splice(optIndex, 1);
    setFormData({ ...formData, attributes: newAttrs });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name) return alert("Set Name is required.");

    // Filter out empty attributes or options
    const cleanAttrs = formData.attributes
      .filter((a) => a.name.trim() !== "")
      .map((a) => ({ name: a.name.trim(), options: a.options }));

    try {
      const url = editingSet
        ? `${API}/api/attribute-sets/${editingSet.id}`
        : `${API}/api/attribute-sets`;
      const method = editingSet ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, attributes: cleanAttrs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await fetchSets();
      setIsModalOpen(false);
      setEditingSet(null);
    } catch (err) {
      alert("Error saving: " + err.message);
    }
  };

  const handleDelete = async (id, name) => {
    if (
      !window.confirm(
        `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      )
    )
      return;
    try {
      const res = await fetch(
        `${API}/api/attribute-sets/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
      fetchSets();
    } catch (err) {
      alert(err.message);
    }
  };

  const filteredSets = sets.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="w-full h-full flex flex-col space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Tags className="text-[#8066FF]" size={28} />
            Attribute Sets
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage product variants like Size, Color, and Material
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-[#8066FF] hover:bg-[#7055E6] text-white px-5 py-2.5 rounded-lg font-bold shadow-md shadow-indigo-200 transition-all flex items-center gap-2"
        >
          <Plus size={18} /> New Attribute Set
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={18}
          />
          <input
            type="text"
            placeholder="Search attribute sets..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8066FF] focus:border-[#8066FF] transition-shadow text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500 font-medium">
            Loading Attribute Sets...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500 font-medium flex flex-col items-center">
            <AlertCircle size={32} className="mb-2" />
            {error}
          </div>
        ) : filteredSets.length === 0 ? (
          <div className="p-16 text-center text-slate-400 flex flex-col items-center">
            <Tags size={48} className="mb-4 opacity-20" />
            <h3 className="text-lg font-bold text-slate-700 mb-1">
              No Attribute Sets Found
            </h3>
            <p className="text-sm max-w-sm">
              Create an attribute set to start defining groups of product
              variations (e.g., T-Shirts with Size and Color).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="p-4 font-bold w-1/4">Name</th>
                  <th className="p-4 font-bold">Description</th>
                  <th className="p-4 font-bold w-1/3">Included Attributes</th>
                  <th className="p-4 font-bold text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSets.map((set) => (
                  <tr
                    key={set.id}
                    className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group"
                  >
                    <td className="p-4 font-bold text-slate-800 text-sm">
                      {set.name}
                    </td>
                    <td className="p-4 text-slate-500 text-sm line-clamp-2">
                      {set.description || "-"}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {set.attributes?.map((attr) => (
                          <div
                            key={attr.id}
                            className="bg-slate-100 border border-slate-200 text-slate-700 px-2 py-1 rounded"
                          >
                            <span className="font-bold mr-1">{attr.name}:</span>
                            <span className="text-slate-500">
                              {attr.options?.map((o) => o.value).join(", ") ||
                                "None"}
                            </span>
                          </div>
                        ))}
                        {(!set.attributes || set.attributes.length === 0) && (
                          <span className="text-slate-400 italic">
                            No attributes defined
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenModal(set)}
                          className="p-1.5 text-slate-400 hover:text-[#8066FF] hover:bg-indigo-50 rounded transition-colors"
                          title="Edit Set"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(set.id, set.name)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete Set"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            onClick={() => { setIsModalOpen(false); setEditingSet(null); }}
          ></div>
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-slide-in-right">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                {editingSet
                  ? <><Edit2 size={20} className="text-[#8066FF]" /> Edit Attribute Set</>
                  : <><Plus size={20} className="text-[#8066FF]" /> New Attribute Set</>
                }
              </h2>
              <button
                onClick={() => { setIsModalOpen(false); setEditingSet(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 bg-slate-200/50 rounded-full"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="flex-1 overflow-y-auto min-h-0 flex flex-col"
            >
              <div className="p-6 space-y-6 flex-1">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                    Set Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-4 py-2 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-[#8066FF] font-medium transition-colors text-sm"
                    placeholder="e.g. Clothing, Shoes, Accessories"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-4 py-2 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-[#8066FF] font-medium transition-colors text-sm"
                    placeholder="Optional details about this grouping"
                  />
                </div>

                <div className="border-t border-slate-100 pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <label className="block text-sm font-bold text-slate-700 uppercase tracking-wide">
                      Variant Attributes
                    </label>
                    <button
                      type="button"
                      onClick={addAttribute}
                      className="text-[#8066FF] text-xs font-bold hover:underline"
                    >
                      + Add Attribute
                    </button>
                  </div>

                  <div className="space-y-4">
                    {formData.attributes.map((attr, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-50 border border-slate-200 rounded-xl p-4 relative"
                      >
                        {formData.attributes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeAttribute(idx)}
                            className="absolute top-3 right-3 text-slate-400 hover:text-red-500"
                          >
                            <X size={16} />
                          </button>
                        )}
                        <div className="mb-3 pr-6">
                          <input
                            type="text"
                            placeholder="Attribute Name (e.g. Size)"
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:border-[#8066FF]"
                            value={attr.name}
                            onChange={(e) =>
                              updateAttributeName(idx, e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <div className="flex flex-wrap gap-2 mb-2">
                            {attr.options.map((opt, optIdx) => (
                              <span
                                key={optIdx}
                                className="bg-[#8066FF]/10 text-[#8066FF] px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1"
                              >
                                {opt}
                                <button
                                  type="button"
                                  onClick={() => removeOption(idx, optIdx)}
                                  className="hover:text-red-500 bg-white/50 rounded-full p-0.5"
                                >
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder="Type an option and press Enter (e.g. Small)"
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-[#8066FF] border-dashed"
                            value={currentOptionInput[idx] || ""}
                            onChange={(e) =>
                              setCurrentOptionInput({
                                ...currentOptionInput,
                                [idx]: e.target.value,
                              })
                            }
                            onKeyDown={(e) => handleOptionInputKeyDown(e, idx)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 shrink-0 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setEditingSet(null); }}
                  className="flex-1 py-2.5 text-slate-600 bg-white border border-slate-200 font-bold rounded-xl hover:bg-slate-50 transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[#8066FF] hover:bg-[#7055E6] text-white font-bold rounded-xl transition-colors shadow-md text-sm"
                >
                  {editingSet ? "Update Attribute Set" : "Save Attribute Set"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
