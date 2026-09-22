import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// Tela do menu "Importar": escolhe a rede e leva pra tela de importação de
// conteúdos/campanhas (/clientes/:id/campanhas). Cliente com rede vinculada é
// redirecionado direto.
export function ImportarShell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === 'client' && user.clientId) {
      navigate(`/clientes/${user.clientId}/campanhas`, { replace: true });
      return;
    }
    (async () => {
      const { data } = await supabase.from('clients').select('id, name').order('name', { ascending: true });
      setClients(data || []);
      setLoading(false);
    })();
  }, [user, navigate]);

  return (
    <div className="min-h-[60vh] text-white">
      <div className="max-w-lg mx-auto mt-8 bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h1 className="text-xl font-bold flex items-center gap-2 mb-1">
          <Upload size={20} className="text-blue-400" /> Importar conteúdos / campanhas
        </h1>
        <p className="text-sm text-gray-400 mb-4">Escolha a rede para abrir a tela de importação do relatório da DisplayForce.</p>
        {loading ? (
          <div className="text-gray-500 text-sm">Carregando redes…</div>
        ) : (
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) navigate(`/clientes/${e.target.value}/campanhas`); }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            <option value="" disabled>Selecione a rede…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
