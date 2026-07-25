require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const paypal = require('@paypal/checkout-server-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============ MIDDLEWARE ============
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(bodyParser.json());

// ============ CLIENTS ============
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// PayPal Configuration
const paypalEnv = process.env.PAYPAL_MODE === 'live'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// ============================================
// 🏠 ROUTE TEST
// ============================================
app.get('/', (req, res) => {
    res.json({
        status: '✅ ColiVoyage API is running!',
        version: '1.0.0',
        message: 'Backend opérationnel 🚀',
        endpoints: [
            'GET /',
            'GET /api/health',
            'POST /api/paypal/create-order',
            'POST /api/paypal/capture',
            'GET /api/user/:userId',
            'GET /api/trajets',
            'POST /api/trajets',
            'GET /api/colis',
            'POST /api/colis'
        ]
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// 🅿️ PAYPAL - CRÉER UNE COMMANDE
// ============================================
app.post('/api/paypal/create-order', async (req, res) => {
    try {
        const { plan, userId } = req.body;
        const amount = plan === 'monthly' ? '2.49' : '9.99';

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'EUR',
                    value: amount
                },
                description: `ColiVoyage Premium ${plan === 'monthly' ? 'Mensuel' : 'Annuel'}`,
                custom_id: userId || 'anonymous'
            }],
            application_context: {
                brand_name: 'ColiVoyage',
                return_url: `${process.env.FRONTEND_URL}/?payment=success&method=paypal`,
                cancel_url: `${process.env.FRONTEND_URL}/?payment=cancel`,
                user_action: 'PAY_NOW'
            }
        });

        const order = await paypalClient.execute(request);

        // Enregistrement du paiement en attente
        if (userId) {
            await supabase.from('payments').insert({
                user_id: userId,
                method: 'paypal',
                amount: parseFloat(amount),
                currency: 'EUR',
                plan,
                status: 'pending',
                transaction_id: order.result.id,
                external_id: order.result.id
            });
        }

        res.json({
            id: order.result.id,
            links: order.result.links,
            success: true
        });
    } catch (error) {
        console.error('PayPal error:', error);
        res.status(500).json({ error: error.message, success: false });
    }
});

// ============================================
// 🅿️ PAYPAL - CAPTURER (Confirmer le paiement)
// ============================================
app.post('/api/paypal/capture', async (req, res) => {
    try {
        const { orderId, userId, plan } = req.body;
        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const capture = await paypalClient.execute(request);

        if (capture.result.status === 'COMPLETED') {
            // Active Premium
            const premiumUntil = new Date();
            if (plan === 'monthly') {
                premiumUntil.setMonth(premiumUntil.getMonth() + 1);
            } else {
                premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
            }

            if (userId) {
                await supabase.from('users').update({
                    is_premium: true,
                    premium_plan: plan,
                    premium_since: new Date().toISOString(),
                    premium_until: premiumUntil.toISOString()
                }).eq('id', userId);

                await supabase.from('payments').update({
                    status: 'completed'
                }).eq('transaction_id', orderId);
            }

            console.log(`✅ Premium activé pour ${userId} - Plan: ${plan}`);
        }

        res.json({
            status: capture.result.status,
            success: true
        });
    } catch (error) {
        console.error('PayPal capture error:', error);
        res.status(500).json({ error: error.message, success: false });
    }
});

// ============================================
// 👤 UTILISATEURS
// ============================================
app.get('/api/user/:userId', async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.params.userId)
            .single();

        if (error) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/user', async (req, res) => {
    try {
        const { data } = await supabase
            .from('users')
            .insert(req.body)
            .select()
            .single();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/user/:userId', async (req, res) => {
    try {
        const { data } = await supabase
            .from('users')
            .update(req.body)
            .eq('id', req.params.userId)
            .select()
            .single();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ✈️ TRAJETS
// ============================================
app.get('/api/trajets', async (req, res) => {
    try {
        const { depart, destination, date } = req.query;
        let query = supabase
            .from('trajets')
            .select('*')
            .eq('is_active', true)
            .order('is_priority', { ascending: false })
            .order('created_at', { ascending: false });

        if (depart) query = query.eq('depart', depart);
        if (destination) query = query.eq('destination', destination);
        if (date) query = query.gte('date_depart', date);

        const { data } = await query;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/trajets', async (req, res) => {
    try {
        const { data } = await supabase
            .from('trajets')
            .insert(req.body)
            .select()
            .single();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 📦 COLIS
// ============================================
app.get('/api/colis', async (req, res) => {
    try {
        const { depart, destination } = req.query;
        let query = supabase
            .from('colis')
            .select('*')
            .eq('status', 'en_attente')
            .order('is_priority', { ascending: false })
            .order('created_at', { ascending: false });

        if (depart) query = query.eq('depart', depart);
        if (destination) query = query.eq('destination', destination);

        const { data } = await query;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/colis', async (req, res) => {
    try {
        const { data } = await supabase
            .from('colis')
            .insert(req.body)
            .select()
            .single();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 🚀 DÉMARRAGE SERVEUR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ColiVoyage Backend running on port ${PORT}`);
    console.log(`📡 Frontend URL: ${process.env.FRONTEND_URL || 'Not set'}`);
    console.log(`💾 Supabase: ${process.env.SUPABASE_URL ? '✅ Connected' : '❌ Not configured'}`);
    console.log(`🅿️ PayPal: ${process.env.PAYPAL_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
});