import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Bell, Save, LayoutDashboard, Plus, X, ArrowUp, ArrowDown, GripVertical, Building2, Eye, Edit3, Monitor, CheckCircle2 } from 'lucide-react';
import { AVAILABLE_WIDGETS, WIDGET_MAP } from '../components/DashboardWidgets';
import type { WidgetType } from '../components/DashboardWidgets';

// Mock Clients for selection
const MOCK_CLIENTS: { id: string; name: string }[] = [];

export function Settings() {
  // Dashboard Config State
  const [activeWidgets, setActiveWidgets] = useState<WidgetType[]>([]);
  const [availableWidgets, setAvailableWidgets] = useState<WidgetType[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Scope and View Mode
  const [selectedScope, setSelectedScope] = useState<string>('global'); // 'global' or client ID
  const [dashboardView, setDashboardView] = useState<'edit' | 'preview'>('edit');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    // Load config based on scope
    const loadConfig = () => {
      let storageKey = 'dashboard-config-global';
      if (selectedScope !== 'global') {
        storageKey = `dashboard-config-${selectedScope}`;
      }

      const savedConfig = localStorage.getItem(storageKey);
      
      // If client specific config doesn't exist, try loading global as fallback for initial state
      if (!savedConfig && selectedScope !== 'global') {
         const globalConfig = localStorage.getItem('dashboard-config-global');
         if (globalConfig) {
            const savedIds = JSON.parse(globalConfig) as string[];
            const active = savedIds.map(wid => AVAILABLE_WIDGETS.find(w => w.id === wid)).filter(Boolean) as WidgetType[];
            const available = AVAILABLE_WIDGETS.filter(w => !savedIds.includes(w.id));
            setActiveWidgets(active);
            setAvailableWidgets(available);
            return;
         }
      }

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
    };

    loadConfig();
  }, [selectedScope]);

  const addWidget = (widget: WidgetType) => {
    setActiveWidgets([...activeWidgets, widget]);
    setAvailableWidgets(availableWidgets.filter(w => w.id !== widget.id));
    setSaveStatus('idle');
  };

  const removeWidget = (widget: WidgetType) => {
    setAvailableWidgets([...availableWidgets, widget]);
    setActiveWidgets(activeWidgets.filter(w => w.id !== widget.id));
    setSaveStatus('idle');
  };

  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const newWidgets = [...activeWidgets];
    if (direction === 'up' && index > 0) {
      [newWidgets[index], newWidgets[index - 1]] = [newWidgets[index - 1], newWidgets[index]];
    } else if (direction === 'down' && index < newWidgets.length - 1) {
      [newWidgets[index], newWidgets[index + 1]] = [newWidgets[index + 1], newWidgets[index]];
    }
    setActiveWidgets(newWidgets);
    setSaveStatus('idle');
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Set a transparent drag image or customize it if needed
    // e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    if (draggedIndex === null || draggedIndex === index) return;

    // Real-time reordering
    const newWidgets = [...activeWidgets];
    const draggedItem = newWidgets[draggedIndex];
    
    // Remove from old position
    newWidgets.splice(draggedIndex, 1);
    // Insert at new position
    newWidgets.splice(index, 0, draggedItem);
    
    setActiveWidgets(newWidgets);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setSaveStatus('idle');
  };

  const handleSave = () => {
    setSaveStatus('saving');
    const storageKey = selectedScope === 'global' ? 'dashboard-config-global' : `dashboard-config-${selectedScope}`;
    localStorage.setItem(storageKey, JSON.stringify(activeWidgets.map(w => w.id)));
    setTimeout(() => setSaveStatus('saved'), 800);
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* Top Header */}
      <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl backdrop-blur-sm">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <SettingsIcon className="text-indigo-500" size={28} /> 
            Configurações do Sistema
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Gerencie preferências globais e personalizações por rede</p>
        </div>
        
        <div className="flex items-center gap-3">
           <div className="flex items-center gap-2 bg-gray-950 px-4 py-2 rounded-xl border border-gray-800">
                <Building2 size={16} className="text-emerald-500" />
                <span className="text-sm text-gray-400">Editando:</span>
                <select 
                  value={selectedScope}
                  onChange={(e) => setSelectedScope(e.target.value)}
                  className="bg-transparent text-white font-medium focus:outline-none min-w-[150px]"
                >
                  <option value="global">Padrão Global</option>
                  {MOCK_CLIENTS.map(client => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
             </div>
           
           <button 
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
          >
            {saveStatus === 'saved' ? <CheckCircle2 size={18} /> : <Save size={18} />}
            {saveStatus === 'saving' ? 'Salvando...' : saveStatus === 'saved' ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-[500px]">
          
        {/* DASHBOARD CONFIGURATION */}
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            
            {/* Dashboard Sub-Tabs */}
            <div className="flex gap-2 bg-gray-900/50 p-1 rounded-lg w-fit border border-gray-800">
               <button 
                 onClick={() => setDashboardView('edit')}
                 className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${dashboardView === 'edit' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
               >
                 <Edit3 size={16} /> Configuração / Editor
               </button>
               <button 
                 onClick={() => setDashboardView('preview')}
                 className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${dashboardView === 'preview' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
               >
                 <Eye size={16} /> Pré-visualização Real
               </button>
            </div>

            {/* EDITOR MODE */}
            {dashboardView === 'edit' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Available Widgets */}
                <div className="lg:col-span-1 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Widgets Disponíveis</h3>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{availableWidgets.length}</span>
                  </div>
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                    {availableWidgets.map(widget => (
                      <div key={widget.id} className="bg-gray-900 border border-gray-800 p-4 rounded-xl flex items-center justify-between group hover:border-gray-600 hover:bg-gray-800 transition-all shadow-sm">
                        <div>
                          <p className="text-sm font-bold text-white">{widget.title}</p>
                          <p className="text-[10px] text-gray-400 uppercase mt-1 bg-gray-950 inline-block px-2 py-0.5 rounded border border-gray-800">{widget.size}</p>
                        </div>
                        <button onClick={() => addWidget(widget)} className="p-2 bg-gray-950 text-emerald-500 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors border border-gray-800 hover:border-emerald-500">
                          <Plus size={18} />
                        </button>
                      </div>
                    ))}
                    {availableWidgets.length === 0 && (
                      <div className="p-8 text-center border-2 border-dashed border-gray-800 rounded-xl">
                        <p className="text-gray-500 text-sm">Todos os widgets adicionados</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Layout */}
                <div className="lg:col-span-2 space-y-4">
                   <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Layout Ativo ({selectedScope === 'global' ? 'Global' : 'Rede Selecionada'})</h3>
                      <p className="text-xs text-gray-500">Arraste para reordenar</p>
                   </div>
                   <div className="bg-gray-950/50 border border-gray-800 rounded-2xl p-6 min-h-[400px] space-y-3">
                      {activeWidgets.map((widget, index) => (
                        <div key={widget.id} className="flex items-center gap-4 bg-gray-900 border border-gray-800 p-4 rounded-xl group hover:border-indigo-500/50 transition-all shadow-sm">
                          <span className="text-gray-600 cursor-move group-hover:text-indigo-400 transition-colors"><GripVertical size={20} /></span>
                          <span className="w-8 h-8 rounded-lg bg-gray-950 flex items-center justify-center text-sm font-bold text-gray-500 border border-gray-800">{index + 1}</span>
                          <div className="flex-1">
                            <p className="text-base font-bold text-white">{widget.title}</p>
                            <p className="text-xs text-gray-400">{widget.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
                              <button onClick={() => moveWidget(index, 'up')} disabled={index === 0} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-30 border-r border-gray-800"><ArrowUp size={16} /></button>
                              <button onClick={() => moveWidget(index, 'down')} disabled={index === activeWidgets.length - 1} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-30"><ArrowDown size={16} /></button>
                            </div>
                            <button onClick={() => removeWidget(widget)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors ml-2"><X size={18} /></button>
                          </div>
                        </div>
                      ))}
                      {activeWidgets.length === 0 && (
                         <div className="h-full flex flex-col items-center justify-center text-gray-500 py-20">
                            <LayoutDashboard size={48} className="mb-4 opacity-20" />
                            <p>Nenhum widget selecionado</p>
                            <p className="text-sm">Adicione widgets do painel à esquerda</p>
                         </div>
                      )}
                   </div>
                </div>
              </div>
            )}

            {/* PREVIEW MODE */}
            {dashboardView === 'preview' && (
              <div className="bg-gray-950 border border-gray-800 rounded-2xl p-6 animate-in zoom-in-95 duration-300">
                <div className="mb-6 flex items-center justify-between border-b border-gray-800 pb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                     <Monitor size={20} className="text-emerald-500" />
                     Pré-visualização: {selectedScope === 'global' ? 'Global' : MOCK_CLIENTS.find(c => c.id === selectedScope)?.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                    Visualização em Tempo Real
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
                  {activeWidgets.map((widget, index) => {
                    const Component = WIDGET_MAP[widget.id];
                    if (!Component) return null;

                    // Grid Span Logic
                    let colSpan = 'lg:col-span-6'; // half default
                    if (widget.size === 'full') colSpan = 'lg:col-span-12';
                    if (widget.size === 'third') colSpan = 'lg:col-span-4';
                    if (widget.size === 'quarter') colSpan = 'lg:col-span-3';
                    if (widget.size === '2/3') colSpan = 'lg:col-span-8';

                    const isDragging = draggedIndex === index;

                    return (
                      <div 
                        key={widget.id} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`col-span-1 ${colSpan} relative group transition-all duration-300 ${isDragging ? 'opacity-50 scale-95 border-2 border-dashed border-indigo-500 rounded-xl' : ''}`}
                      >
                        {/* Drag Handle Overlay */}
                        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-gray-900/90 p-1.5 rounded-lg backdrop-blur-sm border border-gray-700 shadow-xl cursor-move">
                           <div className="p-1.5 text-gray-400 hover:text-white transition-colors" title="Arrastar para mover">
                             <GripVertical size={16} />
                           </div>
                           <button 
                             onClick={() => removeWidget(widget)}
                             className="p-1.5 hover:bg-red-500/20 rounded text-gray-300 hover:text-red-400 ml-1 border-l border-gray-700 pl-2 transition-colors"
                             title="Remover"
                           >
                             <X size={14} />
                           </button>
                        </div>
                        <div className={isDragging ? 'pointer-events-none' : ''}>
                          <Component view="network" />
                        </div>
                      </div>
                    );
                  })}
                  {activeWidgets.length === 0 && (
                    <div className="col-span-full py-20 text-center text-gray-500">
                      <p>Nenhum widget configurado para visualização.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}