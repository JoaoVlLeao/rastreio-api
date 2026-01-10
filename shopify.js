// shopify.js - VERSÃO DEFINITIVA (SEARCH BAR SIMULATION)
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

// --- PASSO 1: A "REDE DE PESCA" (IGUAL BARRA DE PESQUISA) ---
async function broadSearchGraphQL(term) {
    // Note que NÃO usamos "tracking_number:". Usamos apenas o termo puro.
    // Isso força a Shopify a varrer tudo, achando o pedido onde quer que o número esteja.
    const query = `
    {
      orders(first: 5, query: "${term}") {
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
            // Retorna uma lista de IDs de pedidos que "podem" ser o que queremos
            return result.data.orders.edges.map(edge => edge.node.legacyResourceId);
        }
        return [];
    } catch (error) {
        console.error("Erro GraphQL:", error);
        return [];
    }
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }

// --- PASSO 2: O "FILTRO DE OURO" (Validação) ---
function orderHasTracking(order, trackingSearched) {
    if (!order.fulfillments || order.fulfillments.length === 0) return false;
    
    // Limpa espaços e deixa minúsculo para garantir a comparação
    const target = String(trackingSearched).replace(/\s/g, '').toLowerCase();
    
    // Varre todos os envios do pedido para ver se o rastreio existe MESMO
    return order.fulfillments.some(f => {
        // Verifica o campo principal
        const t1 = f.tracking_number ? String(f.tracking_number).replace(/\s/g, '').toLowerCase() : '';
        
        // Verifica se está dentro de uma lista de rastreios
        const t2List = f.tracking_numbers || [];
        const matchInList = t2List.some(t => String(t).replace(/\s/g, '').toLowerCase() === target);

        // Verifica até na URL de rastreio se o número aparece lá
        const t3 = f.tracking_url ? String(f.tracking_url).toLowerCase() : '';
        const matchInUrl = t3.includes(target);

        return t1 === target || matchInList || matchInUrl;
    });
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
        const byCPF = await shopifyGet('/customers/search.json', { query: digits, limit: 1 });
        if (byCPF.customers && byCPF.customers.length > 0) {
            const o = await shopifyGet('/orders.json', { customer_id: byCPF.customers[0].id, status: 'any', limit: 1 });
            return o.orders || [];
        }
    }

    // 3. É Número de Pedido Curto? (Ex: #1024)
    if ((raw.startsWith('#') || digits.length <= 5) && digits.length > 0) {
        const orderName = raw.startsWith('#') ? raw : `#${digits}`;
        const d = await shopifyGet('/orders.json', { name: orderName, status: 'any', limit: 1 });
        if (d.orders && d.orders.length > 0) return d.orders;
    }

    // 4. É RASTREIO LONGO? (A Lógica Nova)
    if (raw.length > 5) {
        // A. Joga a rede: Pede pra Shopify tudo que parece com esse número
        const candidateIds = await broadSearchGraphQL(raw);
        
        // B. Filtra o ouro: Baixa e valida cada candidato
        for (const id of candidateIds) {
            const d = await shopifyGet(`/orders/${id}.json`);
            if (d.order) {
                // C. O momento da verdade: O número tá lá mesmo?
                if (orderHasTracking(d.order, raw)) {
                    return [d.order]; // ACHOU E VALIDOU!
                }
            }
        }
    }

    return [];

  } catch (e) {
    console.error('❌ Erro na busca:', e);
    return [];
  }
}