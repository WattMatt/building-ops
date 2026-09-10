/** `/` lands site roles on My Day and managers on the portfolio dashboard (conformance A1). */
import { useAuth } from '@/contexts/AuthContext';
import Dashboard from './Dashboard';
import MyDay from './MyDay';

export default function RoleHome() {
  const { isAdminOrManager } = useAuth();
  return isAdminOrManager ? <Dashboard /> : <MyDay />;
}
