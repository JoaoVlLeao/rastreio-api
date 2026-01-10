// shopify.js - VERSÃO BLINDADA (COM VALIDAÇÃO DE RASTREIO)
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

// --- BUSCA VIA GRAPHQL (Focada em Rastreio) ---
async function findOrderIdsByTracking(trackingNumber) {
    // A query abaixo pede especificamente ordens que tenham esse tracking number
    const query = `
    {
      orders(first: 3, query: "tracking_number:${trackingNumber}") {
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
        
        if (result.data && result.data.orders && result.data.orders.edges.length > 0) {
            // Retorna um array de IDs encontrados (pode ser mais de um, por segurança)
            return result.data.orders.edges.map(edge => edge.node.legacyResourceId);
        }
        return [];
    } catch (error) {
        console.error("Erro na busca GraphQL:", error);
        return [];
    }
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }

// --- VALIDAÇÃO DE SEGURANÇA ---
// Essa função garante que o pedido encontrado REALMENTE tem o rastreio buscado
function orderHasTracking(order, trackingSearched) {
    if (!order.fulfillments) return false;
    // Normaliza para string para evitar erro de tipo
    const target = String(trackingSearched).trim();
    
    return order.fulfillments.some(f => {
        return String(f.tracking_number).trim() === target;
    });
}

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

    // 2. É CPF? (11 dígitos exatos)
    if (digits.length === 11) {
        const byCPF = await getOrderByCPF(digits);
        if (byCPF) return [byCPF];
    }

    // 3. É Número de Pedido Curto? (Ex: 1024, #1024)
    // Se for curto (<= 5 dígitos), assumimos que é ID de pedido.
    if ((raw.startsWith('#') || digits.length <= 5) && digits.length > 0) {
        const orderName = raw.startsWith('#') ? raw : `#${digits}`;
        const d = await shopifyGet('/orders.json', { name: orderName, status: 'any', limit: 1 });
        // Retorna direto pois busca por nome é exata
        if (d.orders && d.orders.length > 0) return d.orders;
    }

    // 4. É Rastreio (Longo)?
    // Aqui entra a correção do problema do Pedido #1001
    if (raw.length > 5) {
        // Passo A: Acha IDs via GraphQL
        const candidateIds = await findOrderIdsByTracking(raw);
        
        // Passo B: Para cada ID candidato, baixa o pedido completo e VALIDA
        for (const id of candidateIds) {
            const d = await shopifyGet(`/orders/${id}.json`);
            if (d.order) {
                // VERIFICAÇÃO FINAL: O rastreio está dentro deste pedido?
                if (orderHasTracking(d.order, raw)) {
                    return [d.order]; // ACHOU O CORRETO!
                }
            }
        }
        // Se rodou tudo e não validou nenhum, retorna vazio.
        // Isso impede de retornar um pedido aleatório.
    }

    return [];

  } catch (e) {
    console.error('❌ Erro na busca:', e);
    return [];
  }
}