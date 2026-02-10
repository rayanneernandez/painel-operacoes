import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Globe, 
  Activity, 
  ArrowLeft, 
  Clock, 
  Shield, 
  Building2, 
  Video, 
  ChevronRight, 
  ChevronDown,
  MapPin, 
  AlertCircle,
  CheckCircle2,
  MoreVertical,
  LayoutGrid,
  Users,
  BarChart2,
  Image,
  Upload,
  Calendar,
  Settings
} from 'lucide-react';
import { 
  AVAILABLE_WIDGETS, 
  WIDGET_MAP, 
  LineChart, 
  DonutChart, 
  HorizontalBarChart, 
  AgePyramid 
} from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';

// Mock Data para Clientes (Simulando API)
const CLIENT_DATA: Record<string, { name: string; logo?: string }> = {
  '1': { 
    name: 'Tech Solutions Ltda', 
    logo: undefined // Sem logo para demonstrar o placeholder
  },
  '2': { 
    name: 'Kibon Alphaville', 
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Kibon_logo.png/640px-Kibon_logo.png' 
  }
};

// Tipos para a hierarquia
type CameraType = {
  id: string;
  name: string;
  status: 'online' | 'offline';
  type: 'dome' | 'bullet' | 'ptz';
  resolution: '1080p' | '4k';
  lastEvent?: string;
};

type StoreType = {
  id: string;
  name: string;
  address: string;
  city: string;
  status: 'online' | 'offline';
  cameras: CameraType[];
};

// Mock Data
const MOCK_STORES: StoreType[] = [
  {
    id: 'store-1',
    name: 'Loja Matriz - Centro',
    address: 'Av. Paulista, 1000',
    city: 'São Paulo, SP',
    status: 'online',
    cameras: [
      { id: 'cam-1', name: 'Entrada Principal', status: 'online', type: 'bullet', resolution: '4k', lastEvent: 'Movimento detectado há 2min' },
      { id: 'cam-2', name: 'Caixas', status: 'online', type: 'dome', resolution: '1080p' },
      { id: 'cam-3', name: 'Estoque', status: 'offline', type: 'dome', resolution: '1080p', lastEvent: 'Offline há 1h' },
    ]
  },
  {
    id: 'store-2',
    name: 'Filial Shopping Morumbi',
    address: 'Av. Roque Petroni Jr, 1089',
    city: 'São Paulo, SP',
    status: 'online',
    cameras: [
      { id: 'cam-4', name: 'Corredor A', status: 'online', type: 'dome', resolution: '1080p' },
      { id: 'cam-5', name: 'Estacionamento', status: 'online', type: 'ptz', resolution: '4k' },
    ]
  },
  {
    id: 'store-3',
    name: 'Filial Campinas',
    address: 'Rua Barão de Jaguara, 500',
    city: 'Campinas, SP',
    status: 'offline',
    cameras: [
      { id: 'cam-6', name: 'Entrada', status: 'offline', type: 'bullet', resolution: '1080p' },
    ]
  }
];

const TreeView = ({ 
  clientName, 
  stores, 
  onSelectStore, 
  onSelectCamera 
}: { 
  clientName: string, 
  stores: StoreType[], 
  onSelectStore: (s: StoreType) => void, 
  onSelectCamera: (c: CameraType, s: StoreType) => void 
}) => {
  const [expandedStores, setExpandedStores] = useState<string[]>(stores.map(s => s.id));

  const toggleStore = (e: React.MouseEvent, storeId: string) => {
    e.stopPropagation();
    setExpandedStores(prev => 
      prev.includes(storeId) 
        ? prev.filter(id => id !== storeId) 
        : [...prev, storeId]
    );
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-800 bg-gray-950/50">
        <h3 className="font-bold text-white flex items-center gap-2">
          <Globe size={18} className="text-emerald-500" />
          {clientName}
          <span className="text-xs font-normal text-gray-500 ml-2">Rede Corporativa</span>
        </h3>
      </div>
      
      <div className="p-4">
        <div className="space-y-2">
          {stores.map(store => (
            <div key={store.id} className="border border-gray-800 rounded-lg bg-gray-950/30 overflow-hidden">
              {/* Store Header */}
              <div 
                className="flex items-center gap-3 p-3 hover:bg-gray-900/50 cursor-pointer transition-colors group"
                onClick={() => onSelectStore(store)}
              >
                <button 
                  onClick={(e) => toggleStore(e, store.id)}
                  className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-white transition-colors"
                >
                  {expandedStores.includes(store.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                
                <div className={`p-2 rounded-md ${store.status === 'online' ? 'bg-blue-500/10 text-blue-500' : 'bg-red-500/10 text-red-500'}`}>
                  <Building2 size={18} />
                </div>
                
                <div className="flex-1">
                  <div className="text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">
                    {store.name}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <MapPin size={10} /> {store.city}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="hidden sm:inline">{store.cameras.length} Câmeras</span>
                  <div className={`w-2 h-2 rounded-full ${store.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                </div>
              </div>

              {/* Cameras List (Children) */}
              {expandedStores.includes(store.id) && (
                <div className="border-t border-gray-800 bg-black/20">
                  {store.cameras.map((camera, idx) => (
                    <div 
                      key={camera.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCamera(camera, store);
                      }}
                      className={`
                        flex items-center gap-3 py-2 px-3 pl-14 cursor-pointer hover:bg-gray-900/50 transition-colors group
                        ${idx !== store.cameras.length - 1 ? 'border-b border-gray-800/50' : ''}
                      `}
                    >
                      <Video size={14} className={`group-hover:text-white transition-colors ${camera.status === 'online' ? 'text-gray-500' : 'text-red-500'}`} />
                      <span className="text-sm text-gray-400 group-hover:text-white transition-colors">{camera.name}</span>
                      <span className={`text-[10px] ml-auto px-1.5 py-0.5 rounded ${camera.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                        {camera.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export function ClientDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Estado da visualização
  const [view, setView] = useState<'network' | 'store' | 'camera'>('network');
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);

  // Dados do Cliente (Simulação de API)
  const clientData = CLIENT_DATA[id || '1'] || CLIENT_DATA['1'];
  const clientName = clientData.name;
  const clientLogo = clientData.logo;

  // Widget Configuration
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  useEffect(() => {
    // Tenta carregar config do cliente, senão global, senão default
    const loadConfig = () => {
      // 1. Client specific
      const clientConfig = localStorage.getItem(`dashboard-config-${id}`);
      if (clientConfig) {
        const savedIds = JSON.parse(clientConfig) as string[];
        const widgets = savedIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
        setActiveWidgets(widgets);
        setIsLoadingConfig(false);
        return;
      }

      // 2. Global
      const globalConfig = localStorage.getItem('dashboard-config-global');
      if (globalConfig) {
        const savedIds = JSON.parse(globalConfig) as string[];
        const widgets = savedIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
        setActiveWidgets(widgets);
        setIsLoadingConfig(false);
        return;
      }

      // 3. Default
      const defaultIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'campaigns'];
      const widgets = defaultIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
      setActiveWidgets(widgets);
      setIsLoadingConfig(false);
    };

    loadConfig();
  }, [id]);

  // Inicializar estado baseado na navegação
  useEffect(() => {
    if (location.state?.initialView === 'store' && location.state?.storeId) {
      const store = MOCK_STORES.find(s => s.id === location.state.storeId);
      if (store) {
        setSelectedStore(store);
        setView('store');
      }
    }
  }, [location.state]);

  // Handlers de Navegação
  const goToNetwork = () => {
    setView('network');
    setSelectedStore(null);
    setSelectedCamera(null);
  };

  const goToStore = (store: StoreType) => {
    setSelectedStore(store);
    setView('store');
    setSelectedCamera(null);
  };

  const goToCamera = (camera: CameraType) => {
    setSelectedCamera(camera);
    setView('camera');
  };

  // Stats Dinâmicos
  const getStats = () => {
    if (view === 'network') {
      return [
        { label: 'Total Visitantes', value: '246.171', icon: Users, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        { label: 'Média Visitantes Dia', value: '16.411', icon: BarChart2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { label: 'Tempo Médio Visita', value: '03:26', icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
        { label: 'Taxa Conversão', value: '18.7%', icon: Activity, color: 'text-purple-500', bg: 'bg-purple-500/10' },
      ];
    } else if (view === 'store' && selectedStore) {
      return [
        { label: 'TOTAL VISITANTES', value: '391.186', icon: Users, color: 'text-white', bg: 'bg-blue-600' },
        { label: 'MÉDIA VISITANTES DIA', value: '15.647', icon: BarChart2, color: 'text-white', bg: 'bg-blue-600' },
        { label: 'TEMPO MED VISITA', value: '02:07', icon: Clock, color: 'text-white', bg: 'bg-blue-600' },
        { label: 'TEMPO MED CONTATO', value: '00:10', icon: Activity, color: 'text-white', bg: 'bg-blue-600' },
      ];

    } else if (view === 'camera' && selectedCamera) {
      return [
        { label: 'Status', value: selectedCamera.status === 'online' ? 'Gravando' : 'Sem Sinal', icon: Activity, color: selectedCamera.status === 'online' ? 'text-emerald-500' : 'text-red-500', bg: selectedCamera.status === 'online' ? 'bg-emerald-500/10' : 'bg-red-500/10' },
        { label: 'Resolução', value: selectedCamera.resolution.toUpperCase(), icon: Video, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { label: 'Tipo', value: selectedCamera.type.toUpperCase(), icon: Shield, color: 'text-purple-500', bg: 'bg-purple-500/10' },
        { label: 'Retenção', value: '30 Dias', icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
      ];
    }
    return [];
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header com Breadcrumbs */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/clientes')} className="hover:text-emerald-400 transition-colors">
            Clientes
          </button>
          <ChevronRight size={14} />
          <button onClick={goToNetwork} className={`hover:text-emerald-400 transition-colors ${view === 'network' ? 'text-white font-medium' : ''}`}>
            {clientName}
          </button>
          {view !== 'network' && selectedStore && (
            <>
              <ChevronRight size={14} />
              <button onClick={() => goToStore(selectedStore)} className={`hover:text-emerald-400 transition-colors ${view === 'store' ? 'text-white font-medium' : ''}`}>
                {selectedStore.name}
              </button>
            </>
          )}
          {view === 'camera' && selectedCamera && (
            <>
              <ChevronRight size={14} />
              <span className="text-white font-medium">
                {selectedCamera.name}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Área da Logo */}
            <div className="w-16 h-16 bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center overflow-hidden group relative cursor-pointer hover:border-gray-700 transition-all shadow-lg">
              {clientLogo ? (
                <img src={clientLogo} alt="Logo Cliente" className="w-full h-full object-contain p-2" />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-700 group-hover:text-gray-500 transition-colors">
                  <Image size={24} />
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Upload size={16} className="text-white mb-1" />
                    <span className="text-[8px] text-white font-medium uppercase tracking-wider">Add Logo</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                {view === 'network' ? <Globe className="text-emerald-500" /> : 
                 view === 'store' ? <Building2 className="text-blue-500" /> : 
                 <Video className="text-purple-500" />}
                {view === 'network' ? 'Dashboard Geral' : 
                 view === 'store' ? selectedStore?.name : 
                 selectedCamera?.name}
              </h1>
              <p className="text-gray-400 mt-1">
                {view === 'network' ? `Monitorando ${MOCK_STORES.length} lojas nesta rede` : 
                 view === 'store' ? `${selectedStore?.address} - ${selectedStore?.city}` : 
                 'Feed ao vivo e histórico de eventos'}
              </p>
            </div>
          </div>

          {/* Filters Section */}
          <div className="flex items-center gap-3">
             {/* Store Filter */}
             <div className="relative">
               <select 
                  className="bg-gray-900 border border-gray-800 text-white pl-10 pr-8 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none cursor-pointer text-sm min-w-[180px]"
                  onChange={(e) => {
                     const storeId = e.target.value;
                     if (storeId === 'all') {
                       goToNetwork();
                     } else {
                       const store = MOCK_STORES.find(s => s.id === storeId);
                       if (store) goToStore(store);
                     }
                  }}
                  value={view === 'network' ? 'all' : selectedStore?.id || 'all'}
               >
                  <option value="all">Todas as Lojas</option>
                  {MOCK_STORES.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
               </select>
               <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
               <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={14} />
             </div>

             {/* Date Filter */}
             <button className="flex items-center gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors">
               <Calendar size={16} className="text-gray-500" />
               <span className="text-sm">Hoje: 05/02/2026</span>
               <ChevronDown size={14} className="text-gray-500" />
             </button>

             {/* Config Button */}
             <button 
               onClick={() => navigate(`/clientes/${id}/dashboard-config`)}
               className="flex items-center gap-2 bg-gray-900 border border-gray-800 text-white px-4 py-2 rounded-lg hover:border-gray-700 transition-colors"
               title="Configurar Dashboard"
             >
               <Settings size={16} className="text-gray-500" />
               <span className="text-sm hidden md:inline">Configurar</span>
             </button>
          </div>
        </div>
      </div>

      {/* Stats Cards - Simplified */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {getStats().map((stat, index) => (
          <div key={index} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden group hover:border-gray-700 transition-all">
            <div className="bg-blue-600/20 p-2 text-center border-b border-blue-600/10">
               <p className="text-xs text-blue-400 font-bold uppercase tracking-wider">{stat.label}</p>
            </div>
            <div className="p-4 text-center">
               <p className="text-2xl font-bold text-white tracking-tight">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Content Area */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-h-[400px]">
        
        {/* NETWORK VIEW: General Dashboard Charts (Dynamic Layout) */}
        {view === 'network' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 p-6">
             {isLoadingConfig ? (
               <div className="col-span-full flex justify-center py-20">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
               </div>
             ) : activeWidgets.length > 0 ? (
               activeWidgets.map(widget => {
                  const Component = WIDGET_MAP[widget.id];
                  if (!Component) return null;

                  // Grid Span Logic
                  let colSpan = 'lg:col-span-6'; // half default
                  if (widget.size === 'full') colSpan = 'lg:col-span-12';
                  if (widget.size === 'third') colSpan = 'lg:col-span-4';
                  if (widget.size === 'quarter') colSpan = 'lg:col-span-3';
                  if (widget.size === '2/3') colSpan = 'lg:col-span-8';

                  return (
                    <div key={widget.id} className={`col-span-1 ${colSpan} animate-in fade-in zoom-in-95 duration-500`}>
                      <Component view="network" />
                    </div>
                  );
               })
             ) : (
               <div className="col-span-full text-center py-20 text-gray-500">
                 <LayoutGrid size={48} className="mx-auto mb-4 opacity-20" />
                 <p>Nenhum widget configurado para este dashboard.</p>
                 <button onClick={() => navigate(`/clientes/${id}/dashboard-config`)} className="text-emerald-500 hover:underline mt-2 text-sm">Configurar agora</button>
               </div>
             )}
          </div>
        )}

        {/* STORE VIEW: Analytics e Câmeras */}
        {view === 'store' && selectedStore && (
          <div className="space-y-6 bg-transparent border-none">
            
            {/* Linha 1: Tendências de Fluxo */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
                   <Activity size={14} className="text-blue-500" />
                   Média Visitantes Dia - Dia da Semana
                 </h3>
                 <LineChart data={[16893, 16785, 17116, 12753, 17690, 17366, 18107]} color="text-blue-500" height={100} />
                 <div className="flex justify-between text-[10px] text-gray-500 mt-2 uppercase">
                    <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sab</span><span>Dom</span>
                 </div>
               </div>

               <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-xs tracking-wider">
                   <Clock size={14} className="text-emerald-500" />
                   Média Visitantes por Hora
                 </h3>
                 <LineChart data={[10, 20, 50, 100, 300, 800, 1200, 1400, 1300, 1100, 900, 600, 300, 100]} color="text-emerald-500" height={100} />
                 <div className="flex justify-between text-[10px] text-gray-500 mt-2">
                    <span>06h</span><span>09h</span><span>12h</span><span>15h</span><span>18h</span><span>21h</span>
                 </div>
               </div>
            </div>

            {/* Linha 2: Demografia e Atributos */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {/* Pirâmide Etária */}
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Users size={16} className="text-purple-500" />
                   Pirâmide Etária
                 </h3>
                 <AgePyramid />
               </div>

               {/* Gênero */}
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Users size={16} className="text-pink-500" />
                   Gênero
                 </h3>
                 <DonutChart 
                    data={[{ label: 'Masculino', value: 164923 }, { label: 'Feminino', value: 79109 }]} 
                    colors={['#1e40af', '#db2777']}
                 />
                 <div className="flex justify-center gap-4 mt-4 text-xs">
                    <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-blue-800 rounded-full" /> Masculino (67%)</span>
                    <span className="flex items-center gap-1 text-gray-400"><div className="w-2 h-2 bg-pink-600 rounded-full" /> Feminino (32%)</span>
                 </div>
               </div>

               {/* Atributos Diversos (Ex: Cabelo/Barba) */}
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Video size={16} className="text-orange-500" />
                   Atributos Identificados
                 </h3>
                 <div className="space-y-6">
                    <div>
                      <p className="text-xs text-gray-500 mb-2 uppercase">Tipo de Cabelo</p>
                      <HorizontalBarChart 
                        data={[{ label: 'Curto', value: 52 }, { label: 'Longo', value: 35 }, { label: 'Careca', value: 13 }]} 
                        color="bg-orange-500"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-2 uppercase">Acessórios</p>
                      <HorizontalBarChart 
                        data={[{ label: 'Óculos', value: 18 }, { label: 'Boné/Chapéu', value: 12 }, { label: 'Máscara', value: 5 }]} 
                        color="bg-emerald-500"
                      />
                    </div>
                 </div>
               </div>
            </div>

            {/* Linha 3: Jornada e Engajamento */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 lg:col-span-1">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <MapPin size={16} className="text-blue-500" />
                   Jornada do Cliente (Entrada)
                 </h3>
                 <HorizontalBarChart 
                    data={[
                      { label: 'Entrada Princ.', value: 41.5 },
                      { label: 'Estacionamento', value: 19.5 },
                      { label: 'Totem 1', value: 11.9 },
                      { label: 'Totem 2', value: 6.1 },
                      { label: 'Gôndola A', value: 3.6 },
                    ]} 
                    color="bg-blue-600"
                 />
               </div>

               <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 lg:col-span-2">
                 <h3 className="font-bold text-white mb-4 flex items-center gap-2 uppercase text-sm tracking-wider">
                   <Activity size={16} className="text-emerald-500" />
                   Engajamento em Campanhas (Mídia Validada)
                 </h3>
                 <div className="overflow-x-auto">
                   <table className="w-full text-left text-xs text-gray-400">
                     <thead className="text-gray-500 uppercase border-b border-gray-800">
                       <tr>
                         <th className="pb-2 font-medium">Campanha</th>
                         <th className="pb-2 font-medium">Início</th>
                         <th className="pb-2 font-medium">Visitantes</th>
                         <th className="pb-2 font-medium">Tempo Médio</th>
                         <th className="pb-2 font-medium">Atenção</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-800">
                       {[
                         { name: 'Promoção Verão', start: '06/01/2026', vis: 492, time: '18m', att: '15s' },
                         { name: 'Oferta Relâmpago', start: '01/01/2026', vis: 1205, time: '04m', att: '15s' },
                         { name: 'Lançamento X', start: '10/01/2026', vis: 591, time: '22m', att: '15s' },
                         { name: 'Queima de Estoque', start: '11/01/2026', vis: 538, time: '23m', att: '16s' },
                         { name: 'Fidelidade', start: '01/01/2026', vis: 604, time: '24m', att: '15s' },
                       ].map((row, i) => (
                         <tr key={i} className="group hover:bg-gray-800/50 transition-colors">
                           <td className="py-2 text-white font-medium">{row.name}</td>
                           <td className="py-2">{row.start}</td>
                           <td className="py-2 text-emerald-400">{row.vis}</td>
                           <td className="py-2">{row.time}</td>
                           <td className="py-2 text-orange-400">{row.att}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
            </div>

            {/* Câmeras Instaladas removidas */}
          </div>
        )}

        {/* CAMERA VIEW: Analytics Detalhado (Sem Vídeo) */}
        {view === 'camera' && selectedCamera && (
          <div className="space-y-6">
             <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-xl ${selectedCamera.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    <Video size={32} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">{selectedCamera.name}</h2>
                    <p className="text-gray-400 text-sm flex items-center gap-2">
                       <span className={`w-2 h-2 rounded-full ${selectedCamera.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                       {selectedCamera.status === 'online' ? 'Operacional' : 'Offline'}
                       <span className="w-1 h-1 bg-gray-600 rounded-full" />
                       {selectedCamera.type.toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                   <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                      <h4 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-wider">Status do Dispositivo</h4>
                      <div className="space-y-3">
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Resolução</span>
                            <span className="text-white">{selectedCamera.resolution.toUpperCase()}</span>
                         </div>
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Taxa de Quadros</span>
                            <span className="text-white">30 FPS</span>
                         </div>
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Bitrate</span>
                            <span className="text-white">4096 kbps</span>
                         </div>
                         <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Firmware</span>
                            <span className="text-white">v2.4.1</span>
                         </div>
                      </div>
                   </div>

                   <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 md:col-span-2">
                      <h4 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-wider">Eventos Recentes</h4>
                      <div className="space-y-2">
                         {[1, 2, 3].map((_, i) => (
                           <div key={i} className="flex items-center justify-between p-3 bg-gray-900 rounded border border-gray-800/50">
                              <div className="flex items-center gap-3">
                                 <AlertCircle size={16} className="text-orange-500" />
                                 <span className="text-sm text-gray-300">Movimento detectado na zona de interesse</span>
                              </div>
                              <span className="text-xs text-gray-500">Há {i * 15 + 2} min</span>
                           </div>
                         ))}
                      </div>
                   </div>
                </div>
             </div>
          </div>
        )}

      </div>
    </div>
  );
}