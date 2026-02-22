import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, DollarSign, PackageX, ShoppingBag, AlertTriangle, TrendingDown } from 'lucide-react';

export default function Reports() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/reports/dashboard');
        if (!res.ok) throw new Error('Failed to fetch report data');
        const data = await res.json();
        setReportData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchReports();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50 p-8 flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col items-center">
          <BarChart3 className="text-blue-500 w-12 h-12 mb-4 animate-bounce" />
          <p className="text-slate-500 font-medium">Crunching your numbers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50 p-8 h-full">
         <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3">
            <AlertTriangle size={24} />
            <p>Error loading reports: {error}</p>
         </div>
      </div>
    );
  }

  const { totalRevenueToday, todayProfit, inventoryValue, topSelling, lowStock, zReport } = reportData;

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-8 w-full h-full">
      
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Reports Dashboard</h1>
        <p className="text-slate-500 mt-1">Real-time insights and analytics for your store.</p>
      </div>

      {/* Top Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        
        {/* Card 1: Revenue Today */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Total Revenue Today</p>
              <h3 className="text-3xl font-bold text-slate-900">${totalRevenueToday.toFixed(2)}</h3>
            </div>
            <div className="bg-blue-100 p-3 rounded-xl">
              <DollarSign className="text-blue-600 w-6 h-6" />
            </div>
          </div>
          
          <div className="text-xs text-slate-500 border-t border-slate-100 pt-3 mt-4">
            {zReport.length > 0 ? (
                zReport.map(z => (
                  <span key={z.payment_method} className="inline-block mr-3">
                    {z.payment_method}: <span className="font-semibold text-slate-700">${z.total.toFixed(2)}</span>
                  </span>
                ))
            ) : (
                "No sales yet today"
            )}
          </div>
        </div>

        {/* Card 2: Profit Today */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Net Profit Today</p>
              <h3 className="text-3xl font-bold text-emerald-600">${todayProfit.toFixed(2)}</h3>
            </div>
            <div className="bg-emerald-100 p-3 rounded-xl">
              <TrendingUp className="text-emerald-600 w-6 h-6" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Gross Sales minus Cost of Goods Sold</p>
        </div>

        {/* Card 3: Inventory Value */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Est. Inventory Retail Value</p>
              <h3 className="text-3xl font-bold text-indigo-600">${(inventoryValue.retail_value || 0).toFixed(2)}</h3>
            </div>
            <div className="bg-indigo-100 p-3 rounded-xl">
              <PackageX className="text-indigo-600 w-6 h-6" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Base Cost Value: <span className="font-semibold">${(inventoryValue.cost_value || 0).toFixed(2)}</span>
          </p>
        </div>

      </div>

      {/* Bottom Grid: Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Top Selling Items */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <ShoppingBag className="text-blue-500 w-5 h-5" />
            <h3 className="font-bold text-slate-800">Top Selling Products (All Time)</h3>
          </div>
          <div className="p-0">
            {topSelling.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {topSelling.map((item, index) => (
                  <li key={index} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50 transition-colors">
                    <span className="font-medium text-slate-700">{index + 1}. {item.name}</span>
                    <span className="bg-blue-100 text-blue-800 py-1 px-3 rounded-full text-xs font-bold">
                      {item.total_sold} Sold
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
                <div className="p-6 text-center text-slate-500">No sales data available yet.</div>
            )}
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <TrendingDown className="text-rose-500 w-5 h-5" />
            <h3 className="font-bold text-slate-800">Low Stock Alerts (10 or fewer)</h3>
          </div>
          <div className="p-0">
            {lowStock.length > 0 ? (
              <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {lowStock.map((item, index) => (
                  <li key={index} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50 transition-colors">
                    <div>
                      <span className="block font-medium text-slate-700">{item.name}</span>
                      <span className="block text-xs text-slate-400 font-mono mt-0.5">{item.barcode}</span>
                    </div>
                    <span className={`py-1 px-3 rounded-full text-xs font-bold ${item.stock === 0 ? 'bg-rose-100 text-rose-800' : 'bg-orange-100 text-orange-800'}`}>
                      {item.stock} Left
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
                <div className="p-6 text-center text-emerald-600 font-medium">All items are well stocked!</div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
