import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import BackupRestore from "./BackupRestore";
import BackupRestoreRedesign from "./redesign/BackupRestoreRedesign";

export default function BackupRestoreRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_backup_restore ? <BackupRestoreRedesign /> : <BackupRestore />;
}
