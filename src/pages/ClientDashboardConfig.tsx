import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, ArrowLeft, GripVertical, Plus, X, ArrowUp, ArrowDown, LayoutDashboard } from 'lucide-react';
import { AVAILABLE_WIDGETS } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';

export function ClientDashboardConfig() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  // Load initial state from localStorage or default
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [availableWidgets, setAvailableWidgets] = useState<WidgetType[]>([]);

  useEffect(() => {
    const savedConfig = localStorage.getItem(`dashboard_config_${id}`);
    if (savedConfig) {
      const savedIds = JSON.parse(savedConfig) as string[];
      const active = savedIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
      const available = AVAILABLE_WIDGETS.filter(w => !savedIds.includes(w.id));
      setActiveWidgets(active);
      setAvailableWidgets(available);
    } else {
      // Default Initial State
      const defaultActiveIds = ['flow_trend', 'hourly_flow', 'age_pyramid', 'gender_dist', 'attributes', 'journey', 'campaigns'];
      const active = defaultActiveIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
      const available = AVAILABLE_WIDGETS.filter(w => !defaultActiveIds.includes(w.id));
      setActiveWidgets(active);
      setAvailableWidgets(available);
    }
  }, [id]);

  const addWidget = (widget: WidgetType) => {
    setActiveWidgets([...activeWidgets, widget]);
    setAvailableWidgets(availableWidgets.filter(w => w.id !== widget.id));
  };

  const removeWidget = (widget: WidgetType) => {
    setAvailableWidgets([...availableWidgets, widget]);
    setActiveWidgets(activeWidgets.filter(w => w.id !== widget.id));
  };

  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const newWidgets = [...activeWidgets];
    if (direction === 'up' && index > 0) {
      [newWidgets[index], newWidgets[index - 1]] = [newWidgets[index - 1], newWidgets[index]];
    } else if (direction === 'down' && index < newWidgets.length - 1) {
      [newWidgets[index], newWidgets[index + 1]] = [newWidgets[index + 1], newWidgets[index]];
    }
    setActiveWidgets(newWidgets);
  };

  const handleSave = () => {
    localStorage.setItem(`dashboard_config_${id}`, JSON.stringify(activeWidgets.map(w => w.id)));
    navigate(`/clientes/${id}/dashboard`);
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500 min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft size={20} className="text-gray-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <LayoutDashboard className="text-emerald-500" />
              Configurar Dashboard
            </h1>
            <p className="text-gray-400 text-sm">Personalize a visualização e ordem dos gráficos para este cliente</p>
          </div>
        </div>
        <button 
          onClick={handleSave}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg flex items-center gap-2 font-medium transition-all shadow-lg shadow-emerald-900/20"
        >
          <Save size={18} />
          Salvar Layout
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Available Widgets Column */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
             <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Widgets Disponíveis</h2>
             <span className="text-xs text-gray-600">{availableWidgets.length} itens</span>
          </div>
          
          <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-2 custom-scrollbar">
            {availableWidgets.map(widget => (
              <div key={widget.id} className="bg-gray-900/50 border border-gray-800 p-4 rounded-xl flex items-center justify-between group hover:border-gray-700 hover:bg-gray-900 transition-all">
                <div>
                  <h3 className="font-bold text-white text-sm">{widget.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">{widget.description}</p>
                  <span className="inline-block mt-2 text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full uppercase border border-gray-700">
                    Tamanho: {widget.size}
                  </span>
                </div>
                <button 
                  onClick={() => addWidget(widget)}
                  className="p-2 bg-gray-800 rounded-lg text-emerald-500 hover:bg-emerald-500 hover:text-white transition-colors border border-gray-700"
                  title="Adicionar ao Dashboard"
                >
                  <Plus size={18} />
                </button>
              </div>
            ))}
            {availableWidgets.length === 0 && (
              <div className="text-center py-12 text-gray-600 text-sm border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
                Todos os widgets estão em uso
              </div>
            )}
          </div>
        </div>

        {/* Active Layout Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
             <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Layout Ativo (Ordem de Visualização)</h2>
             <span className="text-xs text-emerald-500 font-medium">Salvamento Automático pendente...</span>
          </div>

          <div className="bg-gray-950 border border-gray-800 rounded-xl p-6 min-h-[600px] space-y-3 relative">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none"></div>
            
            {activeWidgets.map((widget, index) => (
              <div key={widget.id} className="relative bg-gray-900 border border-gray-800 p-4 rounded-xl flex items-center gap-4 group hover:border-emerald-500/30 transition-all shadow-sm z-10">
                <div className="text-gray-600 cursor-move flex flex-col gap-0.5 px-1">
                  <GripVertical size={20} />
                </div>
                
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 font-bold text-xs border border-gray-700">
                  {index + 1}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                     <h3 className="font-bold text-white text-sm">{widget.title}</h3>
                     {widget.type === 'chart' && <span className="w-2 h-2 rounded-full bg-blue-500"></span>}
                     {widget.type === 'table' && <span className="w-2 h-2 rounded-full bg-purple-500"></span>}
                     {widget.type === 'kpi' && <span className="w-2 h-2 rounded-full bg-orange-500"></span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{widget.description}</p>
                </div>

                <div className="flex items-center gap-2">
                   <div className="flex flex-col gap-1 mr-2">
                      <button 
                        onClick={() => moveWidget(index, 'up')}
                        disabled={index === 0}
                        className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800 transition-colors"
                        title="Mover para cima"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button 
                        onClick={() => moveWidget(index, 'down')}
                        disabled={index === activeWidgets.length - 1}
                        className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800 transition-colors"
                        title="Mover para baixo"
                      >
                        <ArrowDown size={14} />
                      </button>
                   </div>
                   <div className="w-px h-8 bg-gray-800"></div>
                   <button 
                      onClick={() => removeWidget(widget)}
                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors ml-2"
                      title="Remover do Dashboard"
                    >
                      <X size={18} />
                    </button>
                </div>
              </div>
            ))}

             {activeWidgets.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-20 text-gray-500">
                <LayoutDashboard size={48} className="mb-4 opacity-20" />
                <p>Nenhum widget selecionado.</p>
                <p className="text-xs mt-2">Adicione widgets da lista ao lado para começar.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}