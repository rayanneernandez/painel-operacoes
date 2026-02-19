import { useState, useEffect } from 'react';
import { Search, Plus, LayoutDashboard, Link as LinkIcon, Edit, Trash2, X, Building, Mail, Phone, Key, Server, Settings, Upload, FileText, Lock, Shield, Eye, BarChart2, Download, ChevronDown, ChevronUp, MapPin, Building2, CheckCircle2, Activity, Camera, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import supabase from '../lib/supabase';

// Componente Toggle
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button 
    onClick={onChange}
    className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-emerald-500' : 'bg-gray-700'}`}
  >
    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
  </button>
);

// Tipo fictício para clientes
type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: 'active' | 'inactive' | 'pending';
  plan: 'enterprise' | 'pro' | 'basic';
  apisConnected: number;
  createdAt: string;
  initials: string;
  color: string;
  stores?: Store[];
  logo_url?: string;
};

type Device = {
  id: string;
  name: string;
  type: 'camera' | 'sensor' | 'gateway';
  macAddress: string;
  status: 'online' | 'offline';
};

type Store = {
  id: string;
  name: string;
  city: string;
  devices: Device[];
};

const MOCK_API_DEVICES: Device[] = [];

const MOCK_CLIENTS: Client[] = [];

export function Clients() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'permissions' | 'api' | 'stores'>('details');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);

  // Form States
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    status: 'active' as 'active' | 'inactive' | 'pending',
    plan: 'basic' as 'enterprise' | 'pro' | 'basic',
    notes: '',
    logo_url: ''
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [apiConfig, setApiConfig] = useState({
    environment: 'production',
    authMethod: 'token',
    endpoint: 'https://api.displayforce.ai',
    folderEndpoint: '/public/v1/device-folder/list',
    deviceEndpoint: '/public/v1/device/list',
    analyticsEndpoint: '/public/v1/stats/visitor/list',
    token: '',
    customHeaderKey: '',
    customHeaderValue: '',
    docUrl: '',
    // Data Collection Body Params
    collectionStart: '',
    collectionEnd: '',
    collectTracks: true,
    collectFaceQuality: true,
    collectGlasses: true,
    collectBeard: true,
    collectHairColor: true,
    collectHairType: true,
    collectHeadwear: true
  });

  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const [fetchedAnalytics, setFetchedAnalytics] = useState<any[]>([]);

  // State for managing stores in the modal
  const [editingStores, setEditingStores] = useState<Store[]>([]);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreCity, setNewStoreCity] = useState('');

  // Toast State
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // State for manual device addition
  const [newDeviceName, setNewDeviceName] = useState('');

  // Data for client stores
  const getClientStores = (clientId: string): Store[] => {
    const client = clients.find(c => c.id === clientId);
    return client?.stores || [];
  };

  const fetchClients = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('clients')
        .select(`
          *,
          stores (
            id,
            name,
            city,
            devices (*)
          )
        `);
      
      if (error) throw error;

      if (data) {
        const formattedClients: Client[] = data.map(client => ({
          ...client,
          initials: client.name.substring(0, 1).toUpperCase(),
          color: 'bg-indigo-600',
          stores: client.stores?.map((s: any) => ({
            ...s,
            devices: s.devices || []
          })) || []
        }));
        setClients(formattedClients);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  // Estado de permissões (mock)
  const [perms, setPerms] = useState({
    view_dashboard: true,
    view_reports: false,
    view_analytics: false,
    export_data: false,
    manage_settings: false
  });

  const togglePerm = (key: keyof typeof perms) => {
    setPerms(p => ({ ...p, [key]: !p[key] }));
  };

  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleTestConnection = async () => {
    setApiStatus('testing');
    setConnectionSuccess(false);
    
    try {
      // Validar Token
      if (!apiConfig.token) {
        throw new Error('Token de API é obrigatório');
      }

      // Headers para DisplayForce
      const headers = {
        'X-API-Token': apiConfig.token,
        'Content-Type': 'application/json'
      };

      // 1. Fetch Folders (Lojas) - POST Request
      // Usar proxy se o endpoint for da DisplayForce para evitar erro de CORS
      const isDisplayForce = apiConfig.endpoint.includes('displayforce.ai');
      const baseUrl = isDisplayForce ? '/api-proxy' : apiConfig.endpoint;

      const folderUrl = `${baseUrl}${apiConfig.folderEndpoint}`;
      const folderBody = {
        recursive: true,
        limit: 1000,
        offset: 0
      };

      console.log('Buscando Pastas:', { url: folderUrl, body: folderBody });

      const foldersResponse = await fetch(folderUrl, { 
        method: 'POST',
        headers: {
            'X-API-Token': apiConfig.token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(folderBody)
      });
      
      if (!foldersResponse.ok) {
        const errorText = await foldersResponse.text();
        throw new Error(`Erro ao buscar pastas: ${foldersResponse.status} - ${errorText}`);
      }
      
      const foldersData = await foldersResponse.json();
      console.log('Dados das Pastas:', foldersData);
      const folders = foldersData.data || [];

      // 2. Fetch Devices (Dispositivos) - POST Request
      const deviceUrl = `${baseUrl}${apiConfig.deviceEndpoint}`;
      const deviceBody = {
        recursive: true,
        params: [
          "id",
          "name",
          "parent_id",
          "parent_ids",
          "tags",
          "connection_state",
          "address"
        ],
        limit: 1000,
        offset: 0
      };

      console.log('Buscando Dispositivos:', { url: deviceUrl, body: deviceBody });

      const devicesResponse = await fetch(deviceUrl, { 
        method: 'POST',
        headers: {
            'X-API-Token': apiConfig.token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(deviceBody)
      });
      
      if (!devicesResponse.ok) {
        const errorText = await devicesResponse.text();
        throw new Error(`Erro ao buscar dispositivos: ${devicesResponse.status} - ${errorText}`);
      }

      const devicesData = await devicesResponse.json();
      console.log('Dados dos Dispositivos:', devicesData);
      const devices = devicesData.data || [];

      // Debug: Verificar estrutura do primeiro dispositivo
      if (devices.length > 0) {
          console.log('DEBUG - Primeiro dispositivo retornado:', devices[0]);
          console.log('DEBUG - parent_id presente?', 'parent_id' in devices[0]);
      }

      // 3. Fetch Analytics (Visitor List)
      // Usar proxy para analytics também
      const analyticsUrl = `${baseUrl}${apiConfig.analyticsEndpoint}`;
      
      // Auto-generate dates for testing
      // USER REQUEST: Use a wider range or specific logic. 
      // Setting to start of 2024 to ensure we catch 2025 data mentioned by user.
      const now = new Date();
      const startDate = new Date('2024-01-01T00:00:00Z');
      
      // Construct Body for Analytics Request
      const analyticsBody = {
        start: startDate.toISOString(),
        end: now.toISOString(),
        tracks: true, // Force true as per user request example
        face_quality: true,
        glasses: true,
        facial_hair: true,
        hair_color: true,
        hair_type: true,
        headwear: true,
        additional_attributes: [
          "smile", 
          "pitch", 
          "yaw", 
          "x", 
          "y", 
          "height" 
        ]
      };

      try {
        console.log('Enviando Requisição de Analytics:', { url: analyticsUrl, body: analyticsBody });
        
        const analyticsResponse = await fetch(analyticsUrl, { 
          method: 'POST',
          headers: headers,
          body: JSON.stringify(analyticsBody)
        });

        if (analyticsResponse.ok) {
          const analyticsData = await analyticsResponse.json();
          console.log('Dados de Analytics/Visitantes:', analyticsData);
          
          if (analyticsData.payload && analyticsData.payload.length > 0) {
              const firstVisitor = analyticsData.payload[0];
              console.log('DEBUG ANALYTICS - Primeiro Visitante:', firstVisitor);
              // Tentar identificar o campo de ID do dispositivo
              const possibleDeviceFields = ['device_id', 'source_id', 'camera_id', 'device'];
              const foundField = possibleDeviceFields.find(f => f in firstVisitor);
              console.log('DEBUG ANALYTICS - Campo de Dispositivo encontrado:', foundField || 'NENHUM (Verificar payload)');
              
              setFetchedAnalytics(analyticsData.payload);
          } else {
              setFetchedAnalytics([]);
          }

        } else {
          console.warn(`Erro ao buscar analytics: ${analyticsResponse.statusText}`);
          const errorText = await analyticsResponse.text();
          console.warn('Detalhes do Erro de Analytics:', errorText);
        }
      } catch (error) {
        console.warn('Erro ao buscar analytics:', error);
      }

      // 4. Processar e Vincular (De/Para: parent_id -> folder.id)
      const newStores: Store[] = folders.map((folder: any) => {
        // Encontrar dispositivos que pertencem a esta pasta (Loja)
        // A API retorna 'parent_id' no dispositivo que deve bater com o 'id' da pasta
        // IMPORTANTE: Converter para String para evitar erro de tipo (number vs string)
        // TAMBÉM: Verificar parent_ids para encontrar dispositivos em subpastas
        const storeDevices = devices
          .filter((device: any) => {
             const fId = String(folder.id);
             const dParentId = device.parent_id ? String(device.parent_id) : 'undefined';
             
             const directMatch = dParentId === fId;
             // Verificar se a pasta é um ancestral do dispositivo (para subpastas)
             const ancestorMatch = Array.isArray(device.parent_ids) && device.parent_ids.some((pid: any) => String(pid) === fId);
             
             // Debug específico se falhar
             if (directMatch || ancestorMatch) {
                 // console.log(`Device ${device.name} vinculado a Loja ${folder.name}`);
             }

             return directMatch || ancestorMatch;
          })
          .map((device: any) => ({
            id: String(device.id), // ID do dispositivo não é usado no insert (gera novo UUID)
            name: device.name,
            type: 'camera', // Padrão
            macAddress: String(device.id), // Salvar ID da API no campo macAddress para vínculo
            status: device.connection_state === 'online' ? 'online' : 'offline'
          }));

        // Tentar encontrar uma loja existente com o mesmo nome para manter o ID (UUID)
        // Se não encontrar, criar um ID temporário "new-store-..." para o Supabase gerar um UUID
        const existingStore = editingStores.find(s => s.name.trim().toLowerCase() === folder.name.trim().toLowerCase());
        
        // CORREÇÃO: Garantir que o ID seja um UUID válido ou um ID temporário
        let storeId = `new-store-${folder.id}`;
        if (existingStore && existingStore.id && !existingStore.id.startsWith('new-store')) {
             // Se já existe e tem ID, usamos ele. 
             // O erro 1075 indica que pode haver IDs numéricos antigos no estado ou banco
             // Vamos validar se parece um UUID (simplificado)
             if (existingStore.id.length > 10) { 
                 storeId = existingStore.id;
             }
        }

        return {
          id: storeId,
          name: folder.name,
          city: 'Não informada', // Definir padrão para não ficar vazio
          devices: storeDevices
        };
      });

      console.log('Lojas Mapeadas:', newStores);

      if (newStores.length === 0) {
        throw new Error('Nenhuma loja encontrada na API. Verifique se as pastas existem.');
      }

      // Atualizar estado com dados reais
      setEditingStores(newStores);
      setApiStatus('success');
      setConnectionSuccess(true);
      
      // Show the stores tab so user can see what was fetched
      if (newStores.length > 0) {
        setActiveTab('stores');
      }
      
      // Auto-hide success message after 5 seconds
      setTimeout(() => setConnectionSuccess(false), 5000);

    } catch (error: any) {
      console.error('API Error:', error);
      setApiStatus('error');
      showToast(`Erro ao conectar com a API: ${error.message}`, 'error');
    }
  };

  const formatPhone = (value: string) => {
    // Remove tudo que não é número
    const numbers = value.replace(/\D/g, '');
    
    // Aplica a máscara (XX) XXXXX-XXXX
    if (numbers.length <= 11) {
      return numbers
        .replace(/^(\d{2})(\d)/g, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2');
    }
    
    return numbers.substring(0, 11)
      .replace(/^(\d{2})(\d)/g, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  };

  const handleEdit = async (client: Client, initialTab: 'details' | 'permissions' | 'api' | 'stores' = 'details') => {
    setSelectedClient(client);
    setFormData({
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      status: client.status,
      plan: client.plan,
      notes: '',
      logo_url: client.logo_url || ''
    });
    setLogoPreview(client.logo_url || null);
    setLogoFile(null);

    // Resetar estados para evitar dados do cliente anterior
    setPerms({
      view_dashboard: true,
      view_reports: false,
      view_analytics: false,
      export_data: false,
      manage_settings: false
    });

    setApiConfig({
      environment: 'production',
      authMethod: 'token',
      endpoint: 'https://api.displayforce.ai',
      folderEndpoint: '/public/v1/device-folder/list',
      deviceEndpoint: '/public/v1/device/list',
      analyticsEndpoint: '/public/v1/stats/visitor/list',
      token: '',
      customHeaderKey: '',
      customHeaderValue: '',
      docUrl: '',
      collectionStart: '',
      collectionEnd: '',
      collectTracks: true,
      collectFaceQuality: true,
      collectGlasses: true,
      collectBeard: true,
      collectHairColor: true,
      collectHairType: true,
      collectHeadwear: true
    });

    setApiStatus('idle');
    setConnectionSuccess(false);
    setFetchedAnalytics([]);

    // Fetch permissions
    const { data: permData } = await supabase
      .from('client_permissions')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle(); // Usar maybeSingle para não lançar erro se não existir
    
    if (permData) {
      setPerms({
        view_dashboard: permData.view_dashboard,
        view_reports: permData.view_reports,
        view_analytics: permData.view_analytics,
        export_data: permData.export_data,
        manage_settings: permData.manage_settings
      });
    }

    // Fetch API Config
    const { data: apiData } = await supabase
      .from('client_api_configs')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle();

    if (apiData) {
      setApiConfig({
        environment: apiData.environment || 'production',
        authMethod: apiData.auth_method || 'token',
        endpoint: apiData.api_endpoint || 'https://api.displayforce.ai',
        folderEndpoint: apiData.folder_endpoint || '/public/v1/device-folder/list',
        deviceEndpoint: apiData.device_endpoint || '/public/v1/device/list',
        analyticsEndpoint: apiData.analytics_endpoint || '/public/v1/stats/visitor/list',
        token: apiData.api_key || '',
        customHeaderKey: apiData.custom_header_key || '',
        customHeaderValue: apiData.custom_header_value || '',
        docUrl: apiData.documentation_url || '',
        collectionStart: apiData.collection_start || '',
        collectionEnd: apiData.collection_end || '',
        collectTracks: apiData.collect_tracks ?? true,
        collectFaceQuality: apiData.collect_face_quality ?? true,
        collectGlasses: apiData.collect_glasses ?? true,
        collectBeard: apiData.collect_beard ?? true,
        collectHairColor: apiData.collect_hair_color ?? true,
        collectHairType: apiData.collect_hair_type ?? true,
        collectHeadwear: apiData.collect_headwear ?? true
      });
    }

    setActiveTab(initialTab);
    setEditingStores(client.stores || []);
    setIsEditModalOpen(true);
    setActiveMenu(null);
  };

  const handleNewClient = () => {
    setSelectedClient(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      company: '',
      status: 'active',
      plan: 'basic',
      notes: '',
      logo_url: ''
    });
    setLogoFile(null);
    setLogoPreview(null);
    setPerms({
      view_dashboard: true,
      view_reports: false,
      view_analytics: false,
      export_data: false,
      manage_settings: false
    });
      setApiConfig({
      environment: 'production',
      authMethod: 'token',
      endpoint: 'https://api.displayforce.ai',
      folderEndpoint: '/public/v1/device-folder/list',
      deviceEndpoint: '/public/v1/device/list',
      analyticsEndpoint: '/public/v1/stats/visitor/list',
      token: '',
      customHeaderKey: '',
      customHeaderValue: '',
      docUrl: '',
      collectionStart: '',
      collectionEnd: '',
      collectTracks: true,
      collectFaceQuality: true,
      collectGlasses: true,
      collectBeard: true,
      collectHairColor: true,
      collectHairType: true,
      collectHeadwear: true
    });
    setEditingStores([]);
    setIsEditModalOpen(true);
    setConnectionSuccess(false);
    setFetchedAnalytics([]);
  };

  const handleAddStore = () => {
    if (!newStoreName || !newStoreCity) return;
    const newStore: Store = {
      id: `new-store-${Date.now()}`,
      name: newStoreName,
      city: newStoreCity,
      devices: []
    };
    setEditingStores([...editingStores, newStore]);
    setNewStoreName('');
    setNewStoreCity('');
  };

  const handleRemoveStore = async (storeId: string) => {
    if (!storeId.startsWith('new-store')) {
       // Delete from DB immediately or wait for save?
       // For better UX/Consistency with "Save" button, we should probably mark for deletion or delete on Save.
       // But the current logic for other items is "Save" button.
       // However, to keep it simple and effective:
       try {
         const { error } = await supabase.from('stores').delete().eq('id', storeId);
         if (error) throw error;
       } catch (e) {
         console.error('Error deleting store:', e);
         showToast('Erro ao excluir loja.', 'error');
         return;
       }
    }
    setEditingStores(editingStores.filter(s => s.id !== storeId));
  };

  const handleAddDeviceToStore = (storeId: string, deviceId: string) => {
    // Função desativada/simplificada
  };

  const handleAddManualDevice = (storeId: string) => {
    if (!newDeviceName) return;
    
    const newDevice: Device = {
      id: `new-device-${Date.now()}`,
      name: newDeviceName,
      type: 'camera',
      macAddress: '', // Não obrigatório
      status: 'online'
    };

    setEditingStores(editingStores.map(store => {
      if (store.id === storeId) {
        return { ...store, devices: [...store.devices, newDevice] };
      }
      return store;
    }));

    setNewDeviceName('');
  };

  const handleRemoveDeviceFromStore = (storeId: string, deviceId: string) => {
    setEditingStores(editingStores.map(store => {
      if (store.id === storeId) {
        return { ...store, devices: store.devices.filter(d => d.id !== deviceId) };
      }
      return store;
    }));
  };

  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    clientId: string | null;
    clientName: string;
  }>({
    isOpen: false,
    clientId: null,
    clientName: ''
  });

  const handleDeleteClient = (client: Client) => {
    setDeleteConfirmation({
      isOpen: true,
      clientId: client.id,
      clientName: client.name
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation.clientId) return;
    
    const clientId = deleteConfirmation.clientId;

    try {
      // 1. Delete dependent data
      await supabase.from('client_api_configs').delete().eq('client_id', clientId);
      await supabase.from('client_permissions').delete().eq('client_id', clientId);
      
      // 2. Delete client
      const { error } = await supabase.from('clients').delete().eq('id', clientId);
      
      if (error) throw error;

      // 3. Update UI
      setClients(clients.filter(c => c.id !== clientId));
      if (selectedClient?.id === clientId) {
        setIsEditModalOpen(false);
        setSelectedClient(null);
      }
      
      if (expandedClient === clientId) setExpandedClient(null);
      
      // Close confirmation modal
      setDeleteConfirmation({ isOpen: false, clientId: null, clientName: '' });
      showToast('Cliente excluído com sucesso!');

    } catch (error: any) {
      console.error('Error deleting client:', error);
      showToast(`Erro ao excluir cliente: ${error.message}`, 'error');
    }
  };

  const handleSave = async () => {
    try {
      let logoUrl = formData.logo_url;

      // 0. Upload Logo if exists
      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('logos')
          .upload(filePath, logoFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('logos')
          .getPublicUrl(filePath);

        logoUrl = publicUrl;
      }

      // 1. Save Client
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .upsert({
          id: selectedClient?.id,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          company: formData.company,
          status: formData.status,
          plan: formData.plan,
          notes: formData.notes,
          logo_url: logoUrl
        })
        .select()
        .single();

      if (clientError) throw clientError;
      const clientId = clientData.id;

      // 2. Save Permissions
      const { error: permError } = await supabase.from('client_permissions').upsert({
        client_id: clientId,
        ...perms
      }, { onConflict: 'client_id' });
      if (permError) throw permError;

      // 3. Save API Config
      const { error: apiError } = await supabase.from('client_api_configs').upsert({
        client_id: clientId,
        environment: apiConfig.environment,
        auth_method: apiConfig.authMethod,
        api_endpoint: apiConfig.endpoint,
        folder_endpoint: apiConfig.folderEndpoint,
        device_endpoint: apiConfig.deviceEndpoint,
        analytics_endpoint: apiConfig.analyticsEndpoint,
        api_key: apiConfig.token,
        custom_header_key: apiConfig.customHeaderKey,
        custom_header_value: apiConfig.customHeaderValue,
        documentation_url: apiConfig.docUrl,
        collection_start: apiConfig.collectionStart || null,
        collection_end: apiConfig.collectionEnd || null,
        collect_tracks: apiConfig.collectTracks,
        collect_face_quality: apiConfig.collectFaceQuality,
        collect_glasses: apiConfig.collectGlasses,
        collect_beard: apiConfig.collectBeard,
        collect_hair_color: apiConfig.collectHairColor,
        collect_hair_type: apiConfig.collectHairType,
        collect_headwear: apiConfig.collectHeadwear
      }, { onConflict: 'client_id' });
      if (apiError) throw apiError;

      // 4. Save Stores & Devices
      
      // PREVENIR DUPLICIDADE:
      // Primeiro, identificar quais lojas DEVEM permanecer (as que estão na lista editingStores e possuem ID válido)
      const validStoreIds = editingStores
          .map(s => s.id)
          .filter(id => !id.startsWith('new-store'));

      // Buscar IDs de lojas existentes no banco para este cliente
      const { data: currentDbStores } = await supabase
          .from('stores')
          .select('id')
          .eq('client_id', clientId);

      if (currentDbStores) {
          // Identificar lojas que estão no banco mas NÃO estão na lista atual (devem ser excluídas)
          const idsToDelete = currentDbStores
              .map(s => s.id)
              .filter(id => !validStoreIds.includes(id));
          
          if (idsToDelete.length > 0) {
              console.log('Removendo lojas obsoletas/duplicadas:', idsToDelete);
              await supabase.from('stores').delete().in('id', idsToDelete);
          }
      }

      for (const store of editingStores) {
        const { data: storeData, error: storeError } = await supabase
          .from('stores')
          .upsert({
             id: store.id.startsWith('new-store') ? undefined : store.id,
             client_id: clientId,
             name: store.name,
             city: store.city || 'Não informada'
          })
          .select()
          .single();
          
        if (storeError) throw storeError;
        
        // Delete existing devices to sync
        await supabase.from('devices').delete().eq('store_id', storeData.id);
        
        if (store.devices.length > 0) {
            const devicesToInsert = store.devices.map(d => ({
                store_id: storeData.id,
                name: d.name,
                type: d.type,
                mac_address: d.macAddress,
                status: d.status
            }));
            await supabase.from('devices').insert(devicesToInsert);
        }
      }

      // 5. Save Fetched Analytics Data
      if (fetchedAnalytics.length > 0) {
        try {
          console.log(`Salvando ${fetchedAnalytics.length} registros de analytics...`);
          
          const analyticsToInsert = fetchedAnalytics.map((visit: any) => {
            const mainDeviceId = Array.isArray(visit.devices) && visit.devices.length > 0 
              ? Number(visit.devices[0]) 
              : null;

            const attrs: any = {
              face_quality: visit.face_quality ?? null,
              facial_hair: visit.facial_hair ?? null,
              hair_color: visit.hair_color ?? null,
              hair_type: visit.hair_type ?? null,
              headwear: visit.headwear ?? null,
              glasses: visit.glasses ?? null,
            };

            if (Array.isArray(visit.additional_atributes)) {
              attrs.additional_attributes = visit.additional_atributes;
            }

            return {
              client_id: clientId,
              device_id: mainDeviceId,
              timestamp: visit.start,
              age: typeof visit.age === 'number' ? Math.round(visit.age) : null,
              gender: typeof visit.sex === 'number' ? visit.sex : 0,
              attributes: attrs,
              raw_data: visit
            };
          });

          const chunkSize = 100;
          for (let i = 0; i < analyticsToInsert.length; i += chunkSize) {
            const chunk = analyticsToInsert.slice(i, i + chunkSize);
            const { error: analyticsError } = await supabase
              .from('visitor_analytics')
              .insert(chunk);
            
            if (analyticsError) console.error('Erro ao salvar chunk de analytics:', analyticsError);
          }
        } catch (analyticsErr) {
          console.error('Erro ao processar salvamento de analytics:', analyticsErr);
        }
      }

      setIsEditModalOpen(false);
      await fetchClients(); // Garantir que a lista seja atualizada após salvar
      showToast('Alterações salvas com sucesso!');
    } catch (error: any) {
      console.error('Error saving client:', error);
      
      let msg = error.message || 'Erro desconhecido ao salvar.';
      
      if (msg.includes('row-level security policy')) {
        msg = 'Permissão negada (RLS). Execute o script SQL "supabase_fix_rls.sql" no seu painel Supabase.';
      } else if (msg.includes('duplicate key')) {
        msg = 'Já existe um registro com estes dados (Email ou ID duplicado).';
      } else if (msg.includes('invalid input syntax for type uuid')) {
        msg = 'ERRO DE ID: Este cliente possui um ID antigo ("1075") que não é compatível. Por favor, cancele e EXCLUA este cliente, depois crie um novo.';
      }

      showToast(msg, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building className="text-emerald-500" /> Clientes
          </h1>
          <p className="text-gray-400">Gerencie seus clientes e APIs</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar clientes..." 
              className="bg-gray-900 border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-64 placeholder-gray-600"
            />
          </div>
          <button 
            onClick={fetchClients}
            title="Atualizar Lista"
            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors border border-gray-700"
          >
            <Activity size={18} />
          </button>
          <button 
            onClick={handleNewClient}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-emerald-900/20"
          >
            <Plus size={18} />
            Novo Cliente
          </button>
        </div>
      </div>

      {/* Client List */}
      <div className="space-y-4">
        {clients.length === 0 ? (
          <div className="text-center py-12 bg-gray-900/50 rounded-xl border border-gray-800 border-dashed">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-500">
              <Building size={32} />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Nenhum cliente encontrado</h3>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">
              Comece adicionando seu primeiro cliente para gerenciar lojas e câmeras.
            </p>
            <button 
              onClick={handleNewClient}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg inline-flex items-center gap-2 transition-colors"
            >
              <Plus size={18} />
              Adicionar Primeiro Cliente
            </button>
          </div>
        ) : (
          clients.map((client) => (
          <div key={client.id} className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all group relative flex flex-col gap-4">
            
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl ${client.color} flex items-center justify-center text-white font-bold text-2xl shadow-inner`}>
                  <Building size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-white text-lg">{client.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{client.company}</p>
                  
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
                    <span className="flex items-center gap-1.5"><Mail size={14} /> {client.email}</span>
                    <span className="flex items-center gap-1.5"><Phone size={14} /> {client.phone}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 h-full">
                 <button 
                  onClick={() => setExpandedClient(expandedClient === client.id ? null : client.id)}
                  className={`p-2 rounded-lg border transition-colors ${
                    expandedClient === client.id 
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                      : 'border-gray-700 hover:bg-gray-800 text-gray-300'
                  }`}
                 >
                   {expandedClient === client.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                 </button>

                 <button 
                  onClick={() => navigate(`/clientes/${client.id}/dashboard`)}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-300 text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
                 >
                   <LayoutDashboard size={16} className="text-emerald-500" />
                   Painel
                 </button>
                 
                 <div className="relative">
                  <button 
                      onClick={() => setActiveMenu(activeMenu === client.id ? null : client.id)}
                      className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                  >
                      <Settings size={20} />
                  </button>
                  
                  {/* Dropdown Menu */}
                  {activeMenu === client.id && (
                      <div className="absolute right-0 top-12 w-48 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-10 overflow-hidden">
                      <div className="p-1">
                          <button 
                          onClick={() => handleEdit(client, 'details')}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md flex items-center gap-2"
                          >
                          <Edit size={16} /> Editar Cliente
                          </button>
                          <button 
                          onClick={() => handleEdit(client, 'api')}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md flex items-center gap-2"
                          >
                          <LinkIcon size={16} /> Configurar APIs
                          </button>
                          <div className="h-px bg-gray-800 my-1"></div>
                          <button 
                            onClick={() => handleDeleteClient(client)}
                            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/20 rounded-md flex items-center gap-2"
                          >
                          <Trash2 size={16} /> Excluir
                          </button>
                      </div>
                      </div>
                  )}
                 </div>
              </div>
            </div>

            {/* Stores Expansion */}
            {expandedClient === client.id && (
              <div className="pt-4 border-t border-gray-800 animate-in slide-in-from-top-2 duration-200 w-full">
                <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                  <Building2 size={14} /> Lojas da Rede
                </h4>
                <div className="flex flex-col gap-2">
                  {getClientStores(client.id).length === 0 && (
                    <div className="text-center py-4 bg-gray-900/50 rounded-lg border border-gray-800 border-dashed">
                      <p className="text-gray-500 text-sm">Nenhuma loja vinculada a este cliente.</p>
                      <p className="text-xs text-gray-600 mt-1">Configure a API ou adicione lojas manualmente.</p>
                    </div>
                  )}
                  {getClientStores(client.id).map(store => (
                    <div 
                      key={store.id}
                      className="bg-gray-950 rounded-lg border border-gray-800 overflow-hidden transition-all"
                    >
                      <div 
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-900 transition-colors"
                        onClick={() => setExpandedStore(expandedStore === store.id ? null : store.id)}
                      >
                        <div className="flex items-center gap-4">
                           <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-gray-500 group-hover:text-emerald-500 transition-colors">
                             <Building2 size={16} />
                           </div>
                           <div>
                            <p className="text-sm font-medium text-white group-hover:text-emerald-400">{store.name}</p>
                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <MapPin size={10} /> {store.city}
                            </p>
                           </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/clientes/${client.id}/dashboard`, { state: { initialView: 'store', storeId: store.id } });
                            }}
                            className="p-1.5 text-gray-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
                            title="Ir para Dashboard"
                          >
                            <LayoutDashboard size={16} />
                          </button>
                          {expandedStore === store.id ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                        </div>
                      </div>

                      {/* Store Devices Expansion */}
                      {expandedStore === store.id && (
                        <div className="bg-gray-900/50 border-t border-gray-800 p-3 animate-in slide-in-from-top-2 duration-200">
                          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2 px-1">
                            <Camera size={12} /> Dispositivos Conectados (Recebendo Dados)
                          </h5>
                          
                          {store.devices.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {store.devices.map(device => (
                                <div key={device.id} className="flex items-center justify-between bg-gray-950 p-2 rounded border border-gray-800 group/device hover:border-gray-700 transition-all">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                    <div>
                                      <p className="text-xs font-medium text-gray-300 group-hover/device:text-emerald-400 transition-colors">{device.name}</p>
                                      <p className="text-[10px] text-gray-600 font-mono">{device.macAddress}</p>
                                    </div>
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] bg-gray-900 text-gray-500 px-1.5 py-0.5 rounded border border-gray-800 uppercase">
                                        {device.status === 'online' ? 'Capturando' : 'Offline'}
                                    </span>
                                    <button 
                                        onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/clientes/${client.id}/dashboard`, { state: { initialView: 'device', storeId: store.id, deviceId: device.id } });
                                        }}
                                        className="p-1.5 text-gray-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors opacity-0 group-hover/device:opacity-100"
                                        title="Dashboard da Câmera"
                                    >
                                        <LayoutDashboard size={14} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600 italic px-1">Nenhum dispositivo vinculado a esta loja.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          ))
        )}
      </div>

      {/* MODAL DE EDIÇÃO */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-800 z-10">
              <div className="p-6 flex items-center justify-between pb-4">
                <h2 className="text-xl font-bold text-white">
                  {selectedClient ? 'Editar Cliente' : 'Novo Cliente'}
                </h2>
                <button 
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
              
              {/* Tabs */}
              <div className="flex px-6 gap-6">
                <button 
                  onClick={() => setActiveTab('details')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'details' 
                      ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Dados Gerais
                </button>
                <button 
                  onClick={() => setActiveTab('permissions')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'permissions' 
                      ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Permissões
                </button>
                <button 
                  onClick={() => setActiveTab('api')}
                  className={`pb-3 text-sm font-medium transition-colors relative ${
                    activeTab === 'api' 
                      ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Configuração API
                </button>
                {editingStores.length > 0 && (
                  <button 
                    onClick={() => setActiveTab('stores')}
                    className={`pb-3 text-sm font-medium transition-colors relative ${
                      activeTab === 'stores' 
                        ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' 
                        : 'text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    Lojas Encontradas ({editingStores.length})
                  </button>
                )}
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              {activeTab === 'details' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Nome *</label>
                      <input 
                        type="text" 
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Email *</label>
                      <input 
                        type="email" 
                        value={formData.email}
                        onChange={(e) => setFormData({...formData, email: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Telefone</label>
                      <input 
                        type="text" 
                        value={formData.phone}
                        onChange={(e) => setFormData({...formData, phone: formatPhone(e.target.value)})}
                        placeholder="(11) 99999-9999"
                        maxLength={15}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Empresa</label>
                      <input 
                        type="text" 
                        value={formData.company}
                        onChange={(e) => setFormData({...formData, company: e.target.value})}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Status</label>
                      <select 
                        value={formData.status}
                        onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                      >
                        <option value="active">Ativo</option>
                        <option value="inactive">Inativo</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Logo da Empresa</label>
                    <div className="relative group">
                        <div className="w-full h-32 bg-gray-950 border border-gray-800 rounded-lg flex items-center justify-center overflow-hidden relative cursor-pointer hover:border-emerald-500 transition-colors">
                          {logoPreview ? (
                            <img src={logoPreview} alt="Preview" className="h-full object-contain p-2" />
                          ) : (
                            <div className="flex flex-col items-center text-gray-600">
                              <Upload size={24} className="mb-2" />
                              <span className="text-xs">Clique para fazer upload</span>
                            </div>
                          )}
                          <input 
                              type="file" 
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setLogoFile(file);
                                  setLogoPreview(URL.createObjectURL(file));
                                }
                              }}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </div>
                    </div>
                    <p className="text-xs text-gray-500">Formatos aceitos: PNG, JPG, SVG (Máx. 2MB)</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Observações</label>
                    <textarea 
                        rows={3}
                        value={formData.notes}
                        onChange={(e) => setFormData({...formData, notes: e.target.value})}
                        placeholder="Notas adicionais sobre o cliente..."
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none resize-none"
                    />
                  </div>
                </>
              )}

              {/* Permissions Tab */}
              {activeTab === 'permissions' && (
                <div className="border border-gray-800 rounded-xl bg-gray-950/50 overflow-hidden">
                  <div className="p-4 bg-gray-900/50 border-b border-gray-800">
                    <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                      <Shield size={16} /> Permissões de Acesso
                    </h3>
                  </div>
                  
                  <div className="p-2">
                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <Eye size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Visualizar Dashboard</p>
                          <p className="text-xs text-gray-500">Acesso aos gráficos e métricas</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_dashboard} onChange={() => togglePerm('view_dashboard')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <FileText size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Visualizar Relatórios</p>
                          <p className="text-xs text-gray-500">Acesso aos relatórios detalhados</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_reports} onChange={() => togglePerm('view_reports')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <BarChart2 size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Visualizar Analytics</p>
                          <p className="text-xs text-gray-500">Acesso às análises avançadas</p>
                        </div>
                      </div>
                      <Toggle checked={perms.view_analytics} onChange={() => togglePerm('view_analytics')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <Download size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Exportar Dados</p>
                          <p className="text-xs text-gray-500">Permissão para baixar dados</p>
                        </div>
                      </div>
                      <Toggle checked={perms.export_data} onChange={() => togglePerm('export_data')} />
                    </div>

                    <div className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                          <Settings size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-white text-sm">Gerenciar Configurações</p>
                          <p className="text-xs text-gray-500">Alterar configurações do cliente</p>
                        </div>
                      </div>
                      <Toggle checked={perms.manage_settings} onChange={() => togglePerm('manage_settings')} />
                    </div>
                  </div>
                </div>
              )}

              {/* API Config Section */}
              {activeTab === 'api' && (
                <div className="border border-gray-800 rounded-xl p-5 bg-gray-950/50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                      <Key size={16} /> Configuração da API (DisplayForce.ai)
                    </h3>
                  </div>
                  
                  <div className="space-y-6">
                    
                    {/* Success Message Banner */}
                    {connectionSuccess && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex items-start gap-3 animate-in slide-in-from-top-2 duration-300">
                        <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                        <div>
                          <h4 className="font-bold text-emerald-400 text-sm">Conexão Estabelecida com Sucesso!</h4>
                          <p className="text-emerald-500/70 text-xs mt-1">
                            A API está respondendo corretamente. Os parâmetros de coleta foram validados.
                            Você já pode salvar as configurações e cadastrar dispositivos nas lojas.
                          </p>
                        </div>
                        <button 
                          onClick={() => setConnectionSuccess(false)}
                          className="ml-auto text-emerald-500/50 hover:text-emerald-400 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Endereço da API (Base URL)</label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={apiConfig.endpoint}
                                onChange={(e) => setApiConfig({...apiConfig, endpoint: e.target.value})}
                                placeholder="https://api.displayforce.ai"
                                className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                            <Server className="absolute right-3 top-2.5 text-gray-600" size={16} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Caminho das Pastas (Lojas)</label>
                          <input 
                              type="text" 
                              value={apiConfig.folderEndpoint}
                              onChange={(e) => setApiConfig({...apiConfig, folderEndpoint: e.target.value})}
                              placeholder="/public/v1/device-folder/list"
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 font-mono text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Caminho dos Dispositivos</label>
                          <input 
                              type="text" 
                              value={apiConfig.deviceEndpoint}
                              onChange={(e) => setApiConfig({...apiConfig, deviceEndpoint: e.target.value})}
                              placeholder="/public/v1/device/list"
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 font-mono text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Caminho dos Dados (Analytics)</label>
                          <input 
                              type="text" 
                              value={apiConfig.analyticsEndpoint}
                              onChange={(e) => setApiConfig({...apiConfig, analyticsEndpoint: e.target.value})}
                              placeholder="/public/v1/analytics"
                              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 font-mono text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">X-API-Token</label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={apiConfig.token}
                                onChange={(e) => setApiConfig({...apiConfig, token: e.target.value})}
                                placeholder="Insira seu token aqui"
                                className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                            />
                            <Lock className="absolute right-3 top-2.5 text-gray-600" size={16} />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-800 pt-4">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                            <FileText size={14} /> Parâmetros do Body (Coleta de Dados)
                        </h4>
                        
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                            {/* Booleans */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Rastreamento (Tracks)</span>
                                    <Toggle checked={apiConfig.collectTracks} onChange={() => setApiConfig({...apiConfig, collectTracks: !apiConfig.collectTracks})} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Qualidade Facial</span>
                                    <Toggle checked={apiConfig.collectFaceQuality} onChange={() => setApiConfig({...apiConfig, collectFaceQuality: !apiConfig.collectFaceQuality})} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Óculos</span>
                                    <Toggle checked={apiConfig.collectGlasses} onChange={() => setApiConfig({...apiConfig, collectGlasses: !apiConfig.collectGlasses})} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Barba/Bigode</span>
                                    <Toggle checked={apiConfig.collectBeard} onChange={() => setApiConfig({...apiConfig, collectBeard: !apiConfig.collectBeard})} />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Cor do Cabelo</span>
                                    <Toggle checked={apiConfig.collectHairColor} onChange={() => setApiConfig({...apiConfig, collectHairColor: !apiConfig.collectHairColor})} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Tipo de Cabelo</span>
                                    <Toggle checked={apiConfig.collectHairType} onChange={() => setApiConfig({...apiConfig, collectHairType: !apiConfig.collectHairType})} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-gray-300">Chapéu/Boné</span>
                                    <Toggle checked={apiConfig.collectHeadwear} onChange={() => setApiConfig({...apiConfig, collectHeadwear: !apiConfig.collectHeadwear})} />
                                </div>
                            </div>
                        </div>

                        {/* Additional Attributes */}
                        <div className="mt-4">
                            <label className="text-[10px] text-gray-500 uppercase mb-2 block">Atributos Adicionais</label>
                            <div className="flex flex-wrap gap-2">
                                {['smile', 'pitch', 'yaw', 'x', 'y', 'height'].map(attr => (
                                    <span key={attr} className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
                                        {attr}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="pt-2">
                      <button 
                        onClick={handleTestConnection}
                        disabled={apiStatus === 'testing'}
                        className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                          apiStatus === 'success' 
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                            : 'bg-gray-800 hover:bg-gray-700 text-white'
                        }`}
                      >
                        {apiStatus === 'testing' ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Conectando à DisplayForce.ai...
                          </>
                        ) : apiStatus === 'success' ? (
                          <>
                            <CheckCircle2 size={18} />
                            Conexão Estabelecida
                          </>
                        ) : (
                          <>
                            <Activity size={18} />
                            Testar Conexão e Sincronizar
                          </>
                        )}
                      </button>

                      {/* Feedback Visual da Sincronização */}
                      {editingStores.length > 0 && apiStatus === 'success' && (
                        <div className="mt-4 p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-lg animate-in fade-in slide-in-from-top-2">
                          <h4 className="text-emerald-400 font-bold text-sm mb-2 flex items-center gap-2">
                            <CheckCircle2 size={16} /> Sincronização Automática Concluída
                          </h4>
                          <p className="text-xs text-gray-400 mb-3">
                            Foram detectados e vinculados automaticamente através da API:
                          </p>
                          <div className="flex gap-4">
                             <div className="bg-gray-900 px-3 py-2 rounded border border-gray-800 flex items-center gap-2">
                               <Building2 size={14} className="text-gray-500" />
                               <span className="text-white text-sm font-bold">{editingStores.length}</span>
                               <span className="text-xs text-gray-500">Lojas</span>
                             </div>
                             <div className="bg-gray-900 px-3 py-2 rounded border border-gray-800 flex items-center gap-2">
                               <Camera size={14} className="text-gray-500" />
                               <span className="text-white text-sm font-bold">
                                 {editingStores.reduce((acc, store) => acc + store.devices.length, 0)}
                               </span>
                               <span className="text-xs text-gray-500">Dispositivos</span>
                             </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Stores Tab (New) */}
              {activeTab === 'stores' && (
                <div className="space-y-4">
                   <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-4 mb-6">
                      <h4 className="text-emerald-400 font-bold text-sm mb-2 flex items-center gap-2">
                        <CheckCircle2 size={16} /> Dados Sincronizados
                      </h4>
                      <p className="text-sm text-gray-300">
                        Abaixo estão as lojas e dispositivos encontrados na sua conta DisplayForce. 
                        Clique em <b>Salvar Alterações</b> para confirmar a importação.
                      </p>
                   </div>

                   <div className="grid grid-cols-1 gap-3">
                     {editingStores.map((store, idx) => (
                       <div key={store.id || idx} className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                         <div className="flex items-center justify-between mb-3">
                           <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center text-gray-500">
                               <Building2 size={16} />
                             </div>
                             <div>
                               <h4 className="font-bold text-white text-sm">{store.name}</h4>
                               <p className="text-xs text-gray-500">ID: {store.id.startsWith('new-store') ? 'Novo (Será gerado)' : store.id}</p>
                             </div>
                           </div>
                           <span className="text-xs bg-gray-900 text-gray-400 px-2 py-1 rounded border border-gray-800">
                             {store.devices.length} Dispositivos
                           </span>
                         </div>
                         
                         {store.devices.length > 0 ? (
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pl-11">
                             {store.devices.map((device, dIdx) => (
                               <div key={dIdx} className="bg-gray-900/50 p-2 rounded border border-gray-800/50 flex items-center justify-between">
                                 <div className="flex items-center gap-2">
                                   <div className={`w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                   <span className="text-xs text-gray-300">{device.name}</span>
                                 </div>
                                 <span className="text-[10px] text-gray-600 font-mono">{device.status === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
                               </div>
                             ))}
                           </div>
                         ) : (
                           <p className="text-xs text-gray-500 pl-11 italic">Nenhum dispositivo nesta loja.</p>
                         )}
                       </div>
                     ))}
                   </div>
                </div>
              )}

            </div>

            <div className="p-6 border-t border-gray-800 flex justify-end gap-3 bg-gray-900 sticky bottom-0 z-10">
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium shadow-lg shadow-emerald-900/20 transition-colors"
              >
                Salvar Alterações
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Overlay to close menus */}
      {activeMenu && (
        <div className="fixed inset-0 z-0" onClick={() => setActiveMenu(null)} />
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-right-10 duration-300">
          <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl shadow-2xl border ${
            toast.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-emerald-500/10' 
              : 'bg-red-500/10 border-red-500/20 text-red-500 shadow-red-500/10'
          } backdrop-blur-xl bg-gray-900/95`}>
            <div className={`p-2 rounded-full ${
              toast.type === 'success' ? 'bg-emerald-500/20' : 'bg-red-500/20'
            }`}>
              {toast.type === 'success' ? <CheckCircle2 size={24} /> : <ShieldAlert size={24} />}
            </div>
            <div>
              <h4 className="font-bold text-base">{toast.type === 'success' ? 'Sucesso' : 'Erro'}</h4>
              <p className="text-sm opacity-90 text-gray-300">{toast.message}</p>
            </div>
            <button onClick={() => setToast(null)} className="ml-2 p-1 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmation.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert className="text-red-500" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Excluir Cliente</h3>
                  <p className="text-sm text-gray-400">Esta ação é irreversível.</p>
                </div>
              </div>
              
              <p className="text-gray-300 text-sm mb-6 bg-gray-800/50 p-3 rounded-lg border border-gray-800">
                Tem certeza que deseja excluir o cliente <span className="font-bold text-white">{deleteConfirmation.clientName}</span> e todos os seus dados associados?
              </p>
              
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={() => setDeleteConfirmation({ isOpen: false, clientId: null, clientName: '' })}
                  className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDelete}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-lg shadow-red-900/20 transition-all flex items-center gap-2"
                >
                  <Trash2 size={16} /> Confirmar Exclusão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}