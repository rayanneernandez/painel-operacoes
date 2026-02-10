import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

console.log('Iniciando aplicação...');

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('Elemento root não encontrado!');
  document.body.innerHTML = '<div style="color:red; padding:20px;">Erro Crítico: Elemento root não encontrado no HTML.</div>';
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    console.log('Aplicação renderizada com sucesso.');
  } catch (error) {
    console.error('Erro ao renderizar aplicação:', error);
  }
}