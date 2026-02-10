import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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


function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/clientes" replace />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="clientes/:id/dashboard" element={<ClientDashboard />} />
          <Route path="clientes/:id/dashboard-config" element={<ClientDashboardConfig />} />
          <Route path="usuarios" element={<Users />} />
          <Route path="logs" element={<Logs />} />
          <Route path="permissoes" element={<Permissions />} />
          <Route path="relatorios" element={<Reports />} />
          <Route path="configuracoes" element={<Settings />} />
          <Route path="dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;