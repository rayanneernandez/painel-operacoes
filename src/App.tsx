import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Clients } from './pages/ClientsNew'; 
import { Users } from './pages/Users';
import { Permissions } from './pages/Permissions';
import { Dashboard } from './pages/Dashboard';
import { ClientDashboard } from './pages/ClientDashboard';
import { ClientDashboardConfig } from './pages/ClientDashboardConfig';
import { Settings } from './pages/Settings';
import { Reports } from './pages/Reports';
import { Logs } from './pages/Logs';
import { Login } from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import CampaignUpload from './pages/CampaignUpload';

const PrivateRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Carregando...</div>;
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

const MissingClientLink = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
      <h2 className="text-lg font-bold text-white">Acesso sem rede vinculada</h2>
      <p className="text-sm text-gray-400 mt-2">
        Este usuário está com perfil de cliente, mas não está vinculado a nenhuma rede (client_id).
        Peça para o admin vincular este usuário a um cliente.
      </p>
    </div>
  </div>
);

const HomeRedirect = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Carregando...</div>;
  }

  if (user?.role === 'client') {
    if (!user.clientId) return <MissingClientLink />;
    return <Navigate to={`/clientes/${user.clientId}/dashboard`} replace />;
  }

  return <Navigate to="/clientes" replace />;
};

const AdminOnlyRoute = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Carregando...</div>;
  }

  if (user?.role === 'admin') return <Outlet />;

  if (user?.role === 'client') {
    if (!user.clientId) return <MissingClientLink />;
    return <Navigate to={`/clientes/${user.clientId}/dashboard`} replace />;
  }

  return <Navigate to="/" replace />;
};

const ReportsRoute = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Carregando...</div>;
  }

  if (user?.role === 'admin' || (user?.permissions?.view_reports ?? false)) {
    return <Reports />;
  }

  if (user?.role === 'client') {
    if (!user.clientId) return <MissingClientLink />;
    return <Navigate to={`/clientes/${user.clientId}/dashboard`} replace />;
  }

  return <Navigate to="/" replace />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route element={<PrivateRoute />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomeRedirect />} />

              {/* Rotas do cliente */}
              <Route path="clientes/:id/dashboard" element={<ClientDashboard />} />
              <Route path="clientes/:id/dashboard-config" element={<ClientDashboardConfig />} />

              {/* Rotas liberadas por permissão (admin ou view_reports=true) */}
              <Route path="relatorios" element={<ReportsRoute />} />

              {/* Rotas administrativas */}
              <Route element={<AdminOnlyRoute />}>
                <Route path="clientes" element={<Clients />} />
                <Route path="clientes/:id/campanhas" element={<CampaignUpload />} />
                <Route path="usuarios" element={<Users />} />
                <Route path="logs" element={<Logs />} />
                <Route path="permissoes" element={<Permissions />} />
                <Route path="configuracoes" element={<Settings />} />
                <Route path="dashboard" element={<Dashboard />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;