import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Search, MapPin, Phone } from 'lucide-react';

export default function Outlets() {
  const [outlets, setOutlets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOutlet, setEditingOutlet] = useState(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: ''
  });

  const fetchOutlets = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('http://localhost:5000/api/outlets');
      const data = await res.json();
      setOutlets(data.outlets || []);
    } catch (error) {
      console.error('Error fetching outlets:', error);
      alert('Failed to load outlets.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOutlets();
  }, []);

  const handleOpenModal = (outlet = null) => {
    if (outlet) {
      setEditingOutlet(outlet);
      setFormData({
        name: outlet.name,
        address: outlet.address || '',
        phone: outlet.phone || ''
      });
    } else {
      setEditingOutlet(null);
      setFormData({ name: '', address: '', phone: '' });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingOutlet(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name) {
      alert("Name is required");
      return;
    }

    try {
      const url = editingOutlet 
        ? `http://localhost:5000/api/outlets/${editingOutlet.id}`
        : 'http://localhost:5000/api/outlets';
        
      const method = editingOutlet ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save outlet');
      }

      await fetchOutlets();
      handleCloseModal();
      
    } catch (error) {
      console.error("Save error:", error);
      alert(error.message);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete ${name}?`)) return;

    try {
      const res = await fetch(`http://localhost:5000/api/outlets/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to delete outlet');
      }

      await fetchOutlets();
    } catch (error) {
      console.error('Delete error:', error);
      alert(error.message);
    }
  };

  const filteredOutlets = outlets.filter(o => 
    o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (o.address && o.address.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Store Outlets</h1>
          <p className="text-slate-500 text-sm mt-1">Manage physical store locations and branches</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus size={18} />
          Add Outlet
        </button>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col sm:flex-row justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Search outlets..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
          />
        </div>
      </div>

      {/* Data Grid */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm">
                <th className="p-4 font-medium w-64">Name</th>
                <th className="p-4 font-medium">Address</th>
                <th className="p-4 font-medium w-48">Phone</th>
                <th className="p-4 font-medium text-right w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                 <tr>
                    <td colSpan="4" className="p-8 text-center text-slate-400">Loading outlets...</td>
                 </tr>
              ) : filteredOutlets.length === 0 ? (
                 <tr>
                    <td colSpan="4" className="p-8 text-center text-slate-400">
                      No outlets found. {searchTerm ? 'Try adjusting your search.' : 'Add your first outlet above.'}
                    </td>
                 </tr>
              ) : (
                filteredOutlets.map(outlet => (
                  <tr key={outlet.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group">
                    <td className="p-4">
                      <div className="font-medium text-slate-800 flex items-center gap-2">
                        <MapPin size={16} className="text-indigo-500" />
                        {outlet.name}
                      </div>
                    </td>
                    <td className="p-4 text-slate-600">
                      {outlet.address || <span className="text-slate-400 italic">Not specified</span>}
                    </td>
                    <td className="p-4 text-slate-600">
                      <div className="flex items-center gap-2">
                         <Phone size={14} className="text-slate-400" />
                         {outlet.phone || <span className="text-slate-400 italic">Not specified</span>}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleOpenModal(outlet)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDelete(outlet.id, outlet.name)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-out Modal for Add/Edit */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            onClick={handleCloseModal}
          ></div>
          
          {/* Panel */}
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-slide-in-right">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800">
                {editingOutlet ? 'Edit Outlet' : 'New Outlet'}
              </h2>
              <button 
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 flex-1 overflow-y-auto flex flex-col gap-5">
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Outlet Name *</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Downtown Store"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
                <input 
                  type="text" 
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. 555-0199"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <textarea 
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows="3"
                  placeholder="Full physical address..."
                ></textarea>
              </div>

              <div className="mt-auto pt-6 border-t border-slate-200 flex gap-3">
                <button 
                  type="button" 
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm"
                >
                  {editingOutlet ? 'Save Changes' : 'Create Outlet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
