import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, ShieldCheck, ShieldAlert } from 'lucide-react';

export default function Taxes() {
  const [taxes, setTaxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: null, name: '', rate: '', is_default: false });

  useEffect(() => {
    fetchTaxes();
  }, []);

  const fetchTaxes = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/taxes');
      if (!response.ok) throw new Error('Failed to fetch taxes');
      const data = await response.json();
      setTaxes(data.taxes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = formData.id 
      ? `http://localhost:5000/api/taxes/${formData.id}`
      : 'http://localhost:5000/api/taxes';
    
    const method = formData.id ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          rate: parseFloat(formData.rate),
          is_default: formData.is_default
        })
      });

      if (!response.ok) throw new Error('Failed to save tax configuration');
      
      await fetchTaxes();
      setIsModalOpen(false);
      setFormData({ id: null, name: '', rate: '', is_default: false });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this tax rule?')) return;
    try {
      const response = await fetch(`http://localhost:5000/api/taxes/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete tax');
      fetchTaxes();
    } catch (err) {
      setError(err.message);
    }
  };

  const openEditModal = (tax) => {
    setFormData(tax);
    setIsModalOpen(true);
  };

  if (loading) return <div className="p-6">Loading tax configurations...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tax Configurations</h1>
          <p className="text-slate-500 text-sm mt-1">Manage GST, VAT, and other tax brackets applied to your products.</p>
        </div>
        <button 
          onClick={() => { setFormData({ id: null, name: '', rate: '', is_default: false }); setIsModalOpen(true); }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Add New Tax Rule
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 border border-red-100">
          <ShieldAlert size={20} />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm">
              <th className="p-4 font-semibold">Tax Name / Alias</th>
              <th className="p-4 font-semibold">Rate (%)</th>
              <th className="p-4 font-semibold">Status</th>
              <th className="p-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {taxes.map((tax) => (
              <tr key={tax.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="p-4 font-medium text-slate-800">{tax.name}</td>
                <td className="p-4 text-slate-600">{tax.rate.toFixed(2)}%</td>
                <td className="p-4">
                  {tax.is_default ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                      <ShieldCheck size={14} /> Default Tax
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      Optional
                    </span>
                  )}
                </td>
                <td className="p-4 text-right space-x-2">
                  <button 
                    onClick={() => openEditModal(tax)}
                    className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-white border border-slate-200 rounded-lg hover:border-indigo-200 shadow-sm"
                    title="Edit Tax"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => handleDelete(tax.id)}
                    className="p-2 text-slate-400 hover:text-red-600 transition-colors bg-white border border-slate-200 rounded-lg hover:border-red-200 shadow-sm"
                    title="Delete Tax"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {taxes.length === 0 && (
              <tr>
                <td colSpan="4" className="p-8 text-center text-slate-500">
                  No tax rules configured. Create your first tax bracket to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Check/Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800">
                {formData.id ? 'Edit Tax Rule' : 'Create Tax Rule'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Standard GST"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tax Rate (%)</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="e.g. 18.0"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                  value={formData.rate}
                  onChange={(e) => setFormData({...formData, rate: e.target.value})}
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-3 cursor-pointer p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({...formData, is_default: e.target.checked})}
                  />
                  <div>
                    <span className="block text-sm font-semibold text-slate-800">Set as Default Tax Rule</span>
                    <span className="block text-xs text-slate-500">Apply this automatically to new products</span>
                  </div>
                </label>
              </div>

               <div className="pt-4 flex gap-3">
                 <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                 </button>
                 <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 shadow-sm transition-colors"
                  >
                    Save Rule
                 </button>
               </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
