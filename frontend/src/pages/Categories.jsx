import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, ShieldAlert, Tags } from 'lucide-react';

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: null, name: '', description: '' });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/categories');
      if (!response.ok) throw new Error('Failed to fetch categories');
      const data = await response.json();
      setCategories(data.categories);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = formData.id 
      ? `http://localhost:5000/api/categories/${formData.id}`
      : 'http://localhost:5000/api/categories';
    
    const method = formData.id ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description
        })
      });

      if (!response.ok) throw new Error('Failed to save category');
      
      await fetchCategories();
      setIsModalOpen(false);
      setFormData({ id: null, name: '', description: '' });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this category? Products currently using this category will be unassigned.')) return;
    try {
      const response = await fetch(`http://localhost:5000/api/categories/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete category');
      fetchCategories();
    } catch (err) {
      setError(err.message);
    }
  };

  const openEditModal = (category) => {
    setFormData(category);
    setIsModalOpen(true);
  };

  if (loading) return <div className="p-6">Loading categories...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Product Categories</h1>
          <p className="text-slate-500 text-sm mt-1">Organize your inventory with custom departments and categories.</p>
        </div>
        <button 
          onClick={() => { setFormData({ id: null, name: '', description: '' }); setIsModalOpen(true); }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Add Category
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 border border-red-100">
          <ShieldAlert size={20} />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center p-8 min-h-100">
        {categories.length === 0 ? (
           <div className="text-center">
             <Tags size={48} className="mx-auto text-slate-300 mb-4" />
             <h3 className="text-lg font-bold text-slate-700">No Categories Found</h3>
             <p className="text-slate-500 mb-4">Start organizing your products to get better reporting.</p>
           </div>
        ) : (
           <div className="w-full h-full overflow-hidden self-start">
             <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm">
                    <th className="p-4 font-semibold">Category Name</th>
                    <th className="p-4 font-semibold">Description</th>
                    <th className="p-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-bold text-indigo-900">{cat.name}</td>
                      <td className="p-4 text-slate-600">{cat.description || <span className="text-slate-400 italic">No description</span>}</td>
                      <td className="p-4 text-right space-x-2">
                        <button 
                          onClick={() => openEditModal(cat)}
                          className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-white border border-slate-200 rounded-lg hover:border-indigo-200 shadow-sm"
                          title="Edit Category"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(cat.id)}
                          className="p-2 text-slate-400 hover:text-red-600 transition-colors bg-white border border-slate-200 rounded-lg hover:border-red-200 shadow-sm"
                          title="Delete Category"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
           </div>
        )}
      </div>

      {/* Check/Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800">
                {formData.id ? 'Edit Category' : 'Create Category'}
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Action Figures"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
                <textarea
                  rows="3"
                  placeholder="Additional details about this product line"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                />
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
                    Save Category
                 </button>
               </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
