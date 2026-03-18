import { useEffect, useState } from "react";
import { KeyRound, Lock, Mail, MapPin, Shield, User } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { Badge, Button, Input, PageShell, SectionCard } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";

export default function ProfileRedesign() {
  const { employee } = useAuth();
  const { success, error: showError } = useToast();
  const [profile, setProfile] = useState(null);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  // PIN change
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, outRes] = await Promise.all([
          fetch(`${API}/api/auth/me`),
          employee?.id ? fetch(`${API}/api/employees/${employee.id}/outlets`) : null,
        ]);
        const meData = await meRes.json();
        setProfile(meData.employee || meData);
        if (outRes) {
          const outData = await outRes.json();
          setOutlets(outData.outlets || []);
        }
      } catch { /* silent */ }
      setLoading(false);
    })();
  }, [employee?.id]);

  const changePin = async (e) => {
    e.preventDefault();
    if (newPin !== confirmPin) { showError("PINs do not match"); return; }
    if (newPin.length < 4) { showError("PIN must be at least 4 digits"); return; }
    setSavingPin(true);
    try {
      const res = await fetch(`${API}/api/employees/${employee.id}/change-pin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success("PIN changed successfully");
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
    } catch (err) { showError(err.message); }
    setSavingPin(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { showError("Passwords do not match"); return; }
    if (newPassword.length < 8) { showError("Password must be at least 8 characters"); return; }
    setSavingPassword(true);
    try {
      const res = await fetch(`${API}/api/employees/${employee.id}/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword || undefined, pin: !currentPassword ? currentPin : undefined, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success("Password changed successfully");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) { showError(err.message); }
    setSavingPassword(false);
  };

  if (loading) return <PageShell title="My Profile"><p className="text-sm text-(--ui-text-muted)">Loading...</p></PageShell>;

  return (
    <PageShell title="My Profile" subtitle="View your account details and change your credentials.">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Info Card */}
        <SectionCard className="p-5 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Account Info</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-(--ui-text)"><User size={14} className="text-(--ui-text-muted)" /> {profile?.name}</div>
            <div className="flex items-center gap-2 text-(--ui-text)"><Shield size={14} className="text-(--ui-text-muted)" /> <Badge>{profile?.role || (profile?.role_id === 1 ? "Administrator" : profile?.role_id === 2 ? "Manager" : "Cashier")}</Badge></div>
            {profile?.email && <div className="flex items-center gap-2 text-(--ui-text)"><Mail size={14} className="text-(--ui-text-muted)" /> {profile.email}</div>}
          </div>
          {outlets.length > 0 && (
            <>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted) pt-2">Assigned Outlets</h3>
              <div className="space-y-1">
                {outlets.map((o) => (
                  <div key={o.outlet_id} className="flex items-center gap-2 text-sm text-(--ui-text)">
                    <MapPin size={12} className="text-(--ui-text-muted)" /> {o.name}
                    {o.is_primary && <Badge tone="warning">Primary</Badge>}
                  </div>
                ))}
              </div>
            </>
          )}
        </SectionCard>

        {/* Change PIN */}
        <SectionCard className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Change PIN</h3>
          <form onSubmit={changePin} className="space-y-2">
            <Input type="password" placeholder="Current PIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} required maxLength={10} />
            <Input type="password" placeholder="New PIN (4-10 digits)" value={newPin} onChange={(e) => setNewPin(e.target.value)} required maxLength={10} />
            <Input type="password" placeholder="Confirm new PIN" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} required maxLength={10} />
            {newPin && confirmPin && newPin !== confirmPin && <p className="text-xs text-red-600">PINs do not match</p>}
            <Button tone="primary" type="submit" disabled={savingPin || !currentPin || !newPin || newPin !== confirmPin}>
              <KeyRound size={14} className="mr-1 inline" />{savingPin ? "Saving..." : "Change PIN"}
            </Button>
          </form>
        </SectionCard>

        {/* Change Password */}
        <SectionCard className="p-5 md:col-span-2">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Change Password</h3>
          <form onSubmit={changePassword} className="space-y-2 max-w-md">
            <Input type="password" placeholder="Current password (or PIN if no password set)" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            <Input type="password" placeholder="New password (min 8 chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            <Input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="text-xs text-red-600">Passwords do not match</p>}
            <Button tone="primary" type="submit" disabled={savingPassword || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}>
              <Lock size={14} className="mr-1 inline" />{savingPassword ? "Saving..." : "Change Password"}
            </Button>
          </form>
        </SectionCard>
      </div>
    </PageShell>
  );
}
