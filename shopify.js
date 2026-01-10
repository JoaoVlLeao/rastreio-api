// shopify.js - VERSÃO CORRIGIDA (BUSCA GLOBAL)
import fetch from 'node-fetch';

const STORE_URL = (process.env.SHOPIFY_STORE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.SHOPIFY_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

if (!STORE_URL || !API_TOKEN) {
  console.error('❌ Shopify não configurado.');
}

const BASE = `${STORE_URL}/admin/api/${API_VERSION}`;
const HEADERS = {
  'X-Shopify-Access-Token': API_TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// --- UTILS ---
function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null) u.append(k, v);
  return u.toString();
}

async function shopifyGet(path, params = {}) {
  try {
      const url = `${BASE}${path}?${qs(params)}`;
      const res = await fetch(url, { headers: HEADERS });
      
      if (!res.ok) {
        if (res.status === 429) {
            // Rate limit: espera um pouco e tenta de novo
            await new Promise(r => setTimeout(r, 2000));
            return shopifyGet(path, params);
        }
        return {};
      }
      return res.json();
  } catch (e) {
      console.error(`Erro Shopify REST: ${e.message}`);
      return {};
  }
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }

// --- BUSCA RÁPIDA POR CPF ---
async function getOrderByCPF(cpf) {
    // 1. Acha o cliente pelo CPF (usando a busca de clientes)
    const d = await shopifyGet('/customers/search.json', { query: cpf, limit: 1 });
    if (d.customers && d.customers.length > 0) {
        const customer = d.customers[0];
        // 2. Pega o último pedido desse cliente
        const o = await shopifyGet('/orders.json', { customer_id: customer.id, status: 'any', limit: 1 });
        return o.orders?.[0] || null;
    }
    return null;
}

// --- BUSCA GLOBAL (Simula a barra de pesquisa do Admin) ---
async function searchByGlobalQuery(keyword) {
    // O endpoint /orders/search.json varre rastreio, notas, nomes, etc.
    const d = await shopifyGet('/orders/search.json', { query: keyword, status: 'any', limit: 1 });
    return d.orders || [];
}

// --- EXPORT PRINCIPAL ---
export async function searchOrders(query) {
  if (!query) return [];
  const raw = String(query).trim();
  const digits = onlyDigits(raw);

  try {
    // 1. É E-mail? (Busca exata é mais rápida)
    if (isEmail(raw)) {
        const d = await shopifyGet('/orders.json', { email: raw, status: 'any', limit: 1 });
        if (d.orders && d.orders.length > 0) return d.orders;
    }

    // 2. É CPF? (11 dígitos exatos)
    if (digits.length === 11) {
        const byCPF = await getOrderByCPF(digits);
        if (byCPF) return [byCPF];
    }

    // 3. É Número de Pedido curto? (Ex: #1001 ou 1001)
    // Se for apenas números e curto (até 5 dígitos), tentamos pelo nome direto primeiro
    if ((raw.startsWith('#') || digits.length <= 5) && digits.length > 0) {
        const orderName = raw.startsWith('#') ? raw : `#${digits}`;
        const d = await shopifyGet('/orders.json', { name: orderName, status: 'any', limit: 1 });
        if (d.orders && d.orders.length > 0) return d.orders;
    }

    // 4. FALLBACK: Tenta achar por Rastreio ou qualquer outra coisa
    // Se chegou aqui, é provável que seja um rastreio longo (ex: 888001...)
    // Usamos o endpoint de Search que é igual à barra do admin.
    const globalResults = await searchByGlobalQuery(raw);
    if (globalResults.length > 0) return globalResults;

    return [];

  } catch (e) {
    console.error('❌ Erro na busca:', e);
    return [];
  }
}