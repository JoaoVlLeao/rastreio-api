// shopify.js - VERSÃO HÍBRIDA (REST + GRAPHQL PARA RASTREIO)
import fetch from 'node-fetch';

const STORE_URL = (process.env.SHOPIFY_STORE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.SHOPIFY_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

if (!STORE_URL || !API_TOKEN) {
  console.error('❌ Shopify não configurado.');
}

const BASE = `${STORE_URL}/admin/api/${API_VERSION}`;
const GRAPHQL_URL = `${STORE_URL}/admin/api/${API_VERSION}/graphql.json`;

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
      console.error(`Erro Shopify REST: ${e.message}`);
      return {};
  }
}

// --- FUNÇÃO DE RESGATE VIA GRAPHQL ---
// Essa função simula exatamente o filtro "tracking_number:XYZ" do admin
async function findIdByTracking(trackingNumber) {
    const query = `
    {
      orders(first: 1, query: "tracking_number:${trackingNumber}") {
        edges {
          node {
            legacyResourceId
          }
        }
      }
    }`;

    try {
        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ query })
        });
        
        const result = await response.json();
        
        // Verifica se achou algo
        if (result.data && result.data.orders && result.data.orders.edges.length > 0) {
            return result.data.orders.edges[0].node.legacyResourceId;
        }
        return null;
    } catch (error) {
        console.error("Erro na busca GraphQL:", error);
        return null;
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
        if (d.orders && d.orders.length > 0) return d.orders;
    }

    // 2. É CPF? (Exatamente 11 dígitos)
    if (digits.length === 11) {
        const byCPF = await getOrderByCPF(digits);
        if (byCPF) return [byCPF];
    }

    // 3. É Número de Pedido Curto? (Ex: 1024 ou #1024)
    // Se for curto (até 5 dígitos), assumimos que é número de pedido.
    if ((raw.startsWith('#') || digits.length <= 5) && digits.length > 0) {
        const orderName = raw.startsWith('#') ? raw : `#${digits}`;
        const d = await shopifyGet('/orders.json', { name: orderName, status: 'any', limit: 1 });
        if (d.orders && d.orders.length > 0) return d.orders;
    }

    // 4. FALLBACK: É Código de Rastreio?
    // Se chegou até aqui e tem números ou letras (ex: o seu código 888...),
    // usamos o GraphQL para buscar ESPECIFICAMENTE pelo tracking_number.
    if (raw.length > 5) {
        const orderId = await findIdByTracking(raw);
        if (orderId) {
            // Se achou o ID via GraphQL, busca os detalhes completos via REST
            // para manter a compatibilidade com seu frontend.
            const d = await shopifyGet(`/orders/${orderId}.json`);
            if (d.order) return [d.order];
        }
    }

    return [];

  } catch (e) {
    console.error('❌ Erro na busca:', e);
    return [];
  }
}