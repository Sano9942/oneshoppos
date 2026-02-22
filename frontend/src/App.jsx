import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Inventory from './pages/Inventory';
import POS from './pages/POS';
import Dashboard from './pages/Dashboard';
import Suppliers from './pages/Suppliers';
import PurchaseOrders from './pages/PurchaseOrders';
import AppLayout from './components/AppLayout';
import Taxes from './pages/Taxes';
import Categories from './pages/Categories';
import Outlets from './pages/Outlets';
import Employees from './pages/Employees';
import Brands from './pages/Brands';

// Temporary Placeholders for the new Views
function PlaceholderView({ title }) {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-400">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-300 mb-2">{title}</h2>
        <p>This module is currently under construction.</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        
        {/* POS operates outside the main Dashboard layout for maximum screen real-estate */}
        <Route path="/pos" element={<POS />} />

        {/* The Xstak Dashboard Layout wraps all other routes */}
        <Route element={<AppLayout />}>
           <Route path="/" element={<Dashboard />} />
           <Route path="/inventory" element={<Inventory />} />
           <Route path="/suppliers" element={<Suppliers />} />
           <Route path="/purchase-orders" element={<PurchaseOrders />} />
           
           {/* New Implementation Routes */}
           <Route path="/categories" element={<Categories />} />
           <Route path="/taxes" element={<Taxes />} />
           <Route path="/outlets" element={<Outlets />} />
           <Route path="/employees" element={<Employees />} />
           <Route path="/brands" element={<Brands />} />
           <Route path="/reports" element={<PlaceholderView title="Advanced Reporting" />} />
        </Route>

      </Routes>
    </Router>
  );
}

export default App;
