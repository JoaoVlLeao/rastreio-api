// shopify.js - VERSÃO ESTÁVEL
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
      const res = await fetch(`${BASE}${path}?${qs(params)}`, { headers: HEADERS });
      if (!res.ok) {
        if (res.status === 429) {
            await new Promise(r => setTimeout(r, 2000));
            return shopifyGet(path, params);
        }
        return {};
      }
      return res.json();
  } catch (e) {
      console.error(`Erro Shopify: ${e.message}`);
      return {};
  }
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }

// --- BUSCA RÁPIDA POR CPF ---
async function getOrderByCPF(cpf) {
    const d = await shopifyGet('/customers/search.json', { query: cpf, limit: 1 });
    if (d.customers && d.customers.length > 0) {
        const customer = d.customers[0];
        const o = await shopifyGet('/orders.json', { customer_id: customer.id, status: 'any', limit: 1 });
        return o.orders?.[0] || null;
    }
    return null;
}

// --- EXPORT PRINCIPAL ---
export async function searchOrders(query) {
  if (!query) return [];
  const raw = String(query).trim();
  const digits = onlyDigits(raw);

  try {
    // 1. É E-mail?
    if (isEmail(raw)) {
        const d = await shopifyGet('/orders.json', { email: raw, status: 'any', limit: 1 });
        return d.orders || [];
    }

    // 2. É CPF? (11 dígitos)
    if (digits.length === 11) {
        const byCPF = await getOrderByCPF(digits);
        if (byCPF) return [byCPF];
    }

    // 3. É Número de Pedido?
    const orderName = raw.startsWith('#') ? raw : `#${digits}`;
    const d = await shopifyGet('/orders.json', { name: orderName, status: 'any', limit: 1 });
    
    if (d.orders && d.orders.length > 0) return d.orders;

    return [];

  } catch (e) {
    console.error('❌ Erro na busca:', e);
    return [];
  }
}