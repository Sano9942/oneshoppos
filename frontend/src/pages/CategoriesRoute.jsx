import { useAuth } from "../auth/AuthProvider";
import useFeatureFlags from "../hooks/useFeatureFlags";
import Categories from "./Categories";
import CategoriesRedesign from "./redesign/CategoriesRedesign";

export default function CategoriesRoute() {
  const { authHeaders } = useAuth();
  const { flags } = useFeatureFlags(authHeaders);
  return flags.ui_redesign_categories ? <CategoriesRedesign /> : <Categories />;
}
