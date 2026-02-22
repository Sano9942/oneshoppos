import { useState, useEffect } from 'react';
import { Truck, Plus, Save, X, Search, Trash2, Edit } from 'lucide-react';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:5000/api/suppliers');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuppliers(data.suppliers);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const openModal = (supplier = null) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setFormData({
        name: supplier.name,
        contact_person: supplier.contact_person || '',
        phone: supplier.phone || '',
        email: supplier.email || '',
        address: supplier.address || ''
      });
    } else {
      setEditingSupplier(null);
      setFormData({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: ''
      });
    }
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setError(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const url = editingSupplier 
      ? `http://localhost:5000/api/suppliers/${editingSupplier.id}` 
      : 'http://localhost:5000/api/suppliers';
      
    const method = editingSupplier ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      fetchSuppliers();
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this supplier?")) return;
    
    try {
      const res = await fetch(`http://localhost:5000/api/suppliers/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error("Failed to delete");
      fetchSuppliers();
    } catch (err) {
      alert("Error deleting supplier. Ensure they have no active purchase orders.");
    }
  };


  // Filtered Suppliers
  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.contact_person && s.contact_person.toLowerCase().includes(searchQuery.toLowerCase()))
  );


  return (
    <div className="h-full w-full bg-slate-50 flex flex-col p-8 pb-0">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-slate-800">
            <Truck className="text-indigo-600 drop-shadow-sm" size={32} />
            Suppliers Management
          </h1>
          <p className="text-slate-500 mt-1">Manage vendor contacts and details.</p>
        </div>
        <button 
          onClick={() => openModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium shadow-md shadow-indigo-200 transition-all flex items-center gap-2 transform hover:-translate-y-0.5"
        >
          <Plus size={20} />
          Add New Supplier
        </button>
      </div>

      {/* SEARCH BAR */}
      <div className="bg-white p-4 rounded-t-2xl shadow-sm border-b border-slate-100 flex items-center gap-4 shrink-0 mt-4 relative z-10">
        <div className="relative flex-1 max-w-xl">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="text-slate-400" size={20} />
          </div>
          <input
            type="text"
            placeholder="Search suppliers by name or contact person..."
            className="w-full pl-11 pr-4 py-3 bg-slate-50 border-none rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="text-sm font-medium text-slate-500 px-4">
          Total: {filteredSuppliers.length} Suppliers
        </div>
      </div>

      {/* DATA TABLE AREA */}
      <div className="bg-white shadow-sm flex-1 overflow-auto rounded-b-2xl mb-8 border border-slate-100 relative">
        <table className="w-full text-left border-collapse relative">
          <thead className="bg-slate-50 sticky top-0 z-10 backdrop-blur-sm bg-opacity-90 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <tr>
              <th className="py-4 px-6 font-semibold text-slate-600 text-sm">Supplier Name</th>
              <th className="py-4 px-6 font-semibold text-slate-600 text-sm">Contact Person</th>
              <th className="py-4 px-6 font-semibold text-slate-600 text-sm">Phone</th>
              <th className="py-4 px-6 font-semibold text-slate-600 text-sm">Email</th>
              <th className="py-4 px-6 font-semibold text-slate-600 text-sm text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSuppliers.map((supplier) => (
              <tr key={supplier.id} className="border-b border-slate-100 hover:bg-indigo-50/30 transition-colors group">
                <td className="py-4 px-6 font-medium text-slate-800">{supplier.name}</td>
                <td className="py-4 px-6 text-slate-600">{supplier.contact_person || '-'}</td>
                <td className="py-4 px-6 text-slate-600">{supplier.phone || '-'}</td>
                <td className="py-4 px-6 text-slate-600">{supplier.email || '-'}</td>
                <td className="py-4 px-6">
                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => openModal(supplier)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Edit Supplier"
                    >
                      <Edit size={18} />
                    </button>
                    <button 
                      onClick={() => handleDelete(supplier.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete Supplier"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            
            {filteredSuppliers.length === 0 && !isLoading && (
              <tr>
                <td colSpan="5" className="py-20 text-center text-slate-400">
                  <Truck size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-lg">No suppliers found.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL (ADD / EDIT) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                {editingSupplier ? <Edit className="text-indigo-600" size={20} /> : <Plus className="text-indigo-600" size={20} />}
                {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6">
              
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company Name *</label>
                  <input 
                    type="text" required
                    className="w-full border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-medium text-slate-800"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label>
                    <input 
                        type="text" 
                        className="w-full border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-slate-800"
                        value={formData.contact_person}
                        onChange={(e) => setFormData({...formData, contact_person: e.target.value})}
                    />
                    </div>
                    <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                    <input 
                        type="text" 
                        className="w-full border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-slate-800"
                        value={formData.phone}
                        onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    />
                    </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input 
                    type="email" 
                    className="w-full border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-slate-800"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                  <textarea 
                    className="w-full border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-slate-800 resize-none h-20"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                  />
                </div>

              </div>

              {/* Modal Footer */}
              <div className="mt-8 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={closeModal}
                  className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-md shadow-indigo-200 transition-all flex items-center gap-2 disabled:opacity-70"
                >
                  <Save size={18} />
                  {isLoading ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
