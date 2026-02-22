import { useState, useEffect } from 'react';
import { Package, Plus, Save, X, Search } from 'lucide-react';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pagination State for Performance (5,000 items)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({ barcode: '', name: '', price: '', cost_price: '', gst: '', stock: '', category_id: '', tax_id: '' });

  // Dropdown Data
  const [categories, setCategories] = useState([]);
  const [taxes, setTaxes] = useState([]);

  // Fetch Products
  const fetchProducts = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/products');
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err) {
      console.error("Failed to fetch products", err);
    }
  };

  const fetchDropdowns = async () => {
    try {
      const [catRes, taxRes] = await Promise.all([
        fetch('http://localhost:5000/api/categories'),
        fetch('http://localhost:5000/api/taxes')
      ]);
      const catData = await catRes.json();
      const taxData = await taxRes.json();
      setCategories(catData.categories || []);
      setTaxes(taxData.taxes || []);
    } catch (err) {
      console.error("Failed to fetch dropdowns", err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetchDropdowns();
  }, []);

  // Filter Products locally based on search
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.barcode.includes(searchTerm)
  );

  // Calculate Pagination Data
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredProducts.slice(indexOfFirstItem, indexOfLastItem);

  // Reset to page 1 when searching
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setCurrentPage(1);
  }, [searchTerm]);

  const openModal = (product = null) => {
    if (product) {
      setEditingProduct(product);
      setFormData({ 
        barcode: product.barcode, 
        name: product.name, 
        price: product.price, 
        cost_price: product.cost_price ?? '', 
        gst: product.gst ?? '', 
        stock: product.stock,
        category_id: product.category_id || '',
        tax_id: product.tax_id || ''
      });
    } else {
      setEditingProduct(null);
      // Auto-select default tax if available
      const defaultTax = taxes.find(t => t.is_default);
      setFormData({ 
        barcode: '', 
        name: '', 
        price: '', 
        cost_price: '', 
        gst: '', 
        stock: '',
        category_id: '',
        tax_id: defaultTax ? defaultTax.id : ''
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const url = editingProduct 
        ? `http://localhost:5000/api/products/${editingProduct.id}` 
        : 'http://localhost:5000/api/products';
    
    const method = editingProduct ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode: formData.barcode,
          name: formData.name,
          price: parseFloat(formData.price),
          cost_price: formData.cost_price ? parseFloat(formData.cost_price) : 0,
          gst: formData.gst ? parseFloat(formData.gst) : '',
          stock: parseInt(formData.stock),
          category_id: formData.category_id ? parseInt(formData.category_id) : null,
          tax_id: formData.tax_id ? parseInt(formData.tax_id) : null
        })
      });

      if (res.ok) {
        fetchProducts(); // Refresh list
        closeModal();
      } else {
        const errorData = await res.json();
        alert(`Error: ${errorData.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save product.');
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-8 w-full h-full">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 mt-1">Manage your 5,000+ products here.</p>
        </div>
        <button 
          onClick={() => openModal()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5"
        >
          <Plus size={20} /> Add New Item
        </button>
      </div>

      {/* Toolbar / Search */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            placeholder="Search by name or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm transition-colors"
          />
        </div>
        <div className="text-sm font-medium text-slate-500">
           Showing {filteredProducts.length} items
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Barcode</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product Name</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Price</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Level</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {currentItems.map((product) => (
                <tr key={product.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-mono">
                    {product.barcode}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                    {product.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right">
                    ${product.price ? product.price.toFixed(2) : "0.00"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      product.stock <= 5 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {product.stock} in stock
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={() => openModal(product)} 
                      className="text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                   <td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                     <Package className="mx-auto h-12 w-12 text-slate-300 mb-3" />
                     No products found. Add some to get started!
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-slate-200 sm:px-6">
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-slate-700">
                  Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to <span className="font-medium">{Math.min(indexOfLastItem, filteredProducts.length)}</span> of <span className="font-medium">{filteredProducts.length}</span> results
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Previous
                  </button>
                  <span className="relative inline-flex items-center px-4 py-2 border border-slate-300 bg-white text-sm font-medium text-slate-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Next
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-100 overflow-y-auto w-full" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-slate-900/50 transition-opacity backdrop-blur-sm shadow-2xl" aria-hidden="true" onClick={closeModal}></div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="inline-block align-bottom bg-white rounded-2xl text-left shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg w-full relative z-101">
              <form onSubmit={handleSave}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 rounded-t-2xl">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg leading-6 font-bold text-slate-900" id="modal-title">
                      {editingProduct ? 'Edit Product' : 'Add New Product'}
                    </h3>
                    <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-500 transition-colors">
                      <X size={24} />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Barcode</label>
                      <input required type="text" value={formData.barcode} onChange={e => setFormData({...formData, barcode: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. 123456789" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                      <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. Coca Cola 500ml" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Selling Price ($)</label>
                        <input required type="number" step="0.01" min="0" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="0.00" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Cost Price ($)</label>
                        <input required type="number" step="0.01" min="0" value={formData.cost_price} onChange={e => setFormData({...formData, cost_price: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="0.00" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                        <select 
                          value={formData.category_id} 
                          onChange={e => setFormData({...formData, category_id: e.target.value})}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">No Category</option>
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Tax Profile</label>
                        <select 
                          value={formData.tax_id} 
                          onChange={e => setFormData({...formData, tax_id: e.target.value})}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        >
                          <option value="">Legacy GST</option>
                          {taxes.map(tax => (
                            <option key={tax.id} value={tax.id}>{tax.name} ({tax.rate}%)</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Stock Level</label>
                        <input required type="number" min="0" value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="100" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-slate-200 rounded-b-2xl">
                  <button type="submit" className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm transition-colors">
                    <Save size={18} className="mr-2" />
                    {editingProduct ? 'Update Product' : 'Save Product'}
                  </button>
                  <button type="button" onClick={closeModal} className="mt-3 w-full inline-flex justify-center rounded-lg border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
