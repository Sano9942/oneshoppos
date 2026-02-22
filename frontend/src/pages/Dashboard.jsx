import { LayoutDashboard } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-slate-400">
      <LayoutDashboard size={64} className="mb-4 opacity-20" />
      <h2 className="text-2xl font-bold text-slate-300 mb-2">Dashboard Home</h2>
      <p>This module will be built out with the advanced reporting metrics.</p>
    </div>
  );
}
