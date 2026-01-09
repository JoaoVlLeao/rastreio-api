import express from 'express';
import cors from 'cors';
import { searchOrders } from './shopify.js';

const app = express();

app.use(cors({ origin: '*' }));

app.get('/api/rastreio', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Faltou o parâmetro de busca.' });
    }

    try {
        const orders = await searchOrders(query);

        if (!orders || orders.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        const order = orders[0];
        
        // --- ATUALIZAÇÃO: Enviando o status do pagamento ---
        const responseData = {
            name: order.name,
            created_at: order.created_at,
            trackingNumber: order.fulfillments?.[0]?.tracking_number || null,
            customer_name: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Cliente',
            financial_status: order.financial_status // O SEGREDO ESTÁ AQUI
        };

        return res.json(responseData);

    } catch (error) {
        console.error("Erro no servidor:", error);
        return res.status(500).json({ error: 'Erro interno ao processar pedido.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});