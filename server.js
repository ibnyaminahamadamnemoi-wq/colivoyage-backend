require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// ============================================
// 🛡️ MIDDLEWARE
// ============================================
app.use(cors({ 
    origin: '*', 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================
// 🔌 INITIALISATION DES SERVICES (SÉCURISÉE)
// ============================================
let supabase = null;
let paypalClient = null;
let paypal = null;

// --- SUPABASE ---
console.log('\n🔍 Vérification des variables d\'environnement...');
console.log('PORT:', process.env.PORT || '3000 (défaut)');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ présent' : '❌ MANQUANT');
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? '✅ présent' : '❌ MANQUANT');
console.log('PAYPAL_CLIENT_ID:', process.env.PAYPAL_CLIENT_ID ? '✅ présent' : '❌ MANQUANT');
console.log('PAYPAL_SECRET:', process.env.PAYPAL_SECRET ? '✅ présent' : '❌ MANQUANT');
console.log('PAYPAL_MODE:', process.env.PAYPAL_MODE || 'sandbox (défaut)');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || '❌ MANQUANT');
console.log('');

try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(
            process.env.SUPABASE_URL, 
            process.env.SUPABASE_SERVICE_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );
        console.log('✅ Supabase connecté avec succès');
    } else {
        console.log('⚠️  Supabase non configuré - Variables manquantes');
    }
} catch (error) {
    console.log('❌ Erreur Supabase:', error.message);
    supabase = null;
}

// --- PAYPAL ---
try {
    if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET) {
        paypal = require('@paypal/checkout-server-sdk');
        const paypalEnv = process.env.PAYPAL_MODE === 'live'
            ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
            : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
        paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);
        console.log(`✅ PayPal connecté en mode ${process.env.PAYPAL_MODE || 'sandbox'}`);
    } else {
        console.log('⚠️  PayPal non configuré - Variables manquantes');
    }
} catch (error) {
    console.log('❌ Erreur PayPal:', error.message);
    paypalClient = null;
}

// ============================================
// 🏠 ROUTES DE BASE
// ============================================

// Route d'accueil
app.get('/', (req, res) => {
    res.json({
        status: '✅ ColiVoyage API is running!',
        version: '1.0.0',
        message: 'Backend opérationnel 🚀',
        timestamp: new Date().toISOString(),
        services: {
            supabase: supabase ? '✅ Connected' : '❌ Not configured',
            paypal: paypalClient ? '✅ Connected' : '❌ Not configured'
        },
        env_check: {
            SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'missing',
            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'set' : 'missing',
            PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID ? 'set' : 'missing',
            PAYPAL_SECRET: process.env.PAYPAL_SECRET ? 'set' : 'missing',
            PAYPAL_MODE: process.env.PAYPAL_MODE || 'sandbox',
            FRONTEND_URL: process.env.FRONTEND_URL || 'missing',
            PORT: process.env.PORT || '3000'
        },
        endpoints: {
            public: [
                'GET  /',
                'GET  /api/health',
                'GET  /api/trajets',
                'GET  /api/colis'
            ],
            paypal: [
                'POST /api/paypal/create-order',
                'POST /api/paypal/capture'
            ],
            users: [
                'GET  /api/user/:userId',
                'POST /api/user',
                'PUT  /api/user/:userId'
            ],
            trajets: [
                'POST /api/trajets',
                'PUT  /api/trajets/:trajetId',
                'DELETE /api/trajets/:trajetId'
            ],
            colis: [
                'POST /api/colis',
                'PUT  /api/colis/:colisId'
            ]
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ============================================
// 💳 PAYPAL - CRÉER UNE COMMANDE
// ============================================
app.post('/api/paypal/create-order', async (req, res) => {
    if (!paypalClient) {
        return res.status(503).json({ 
            error: 'PayPal non configuré',
            message: 'Contactez l\'administrateur' 
        });
    }
    
    try {
        const { plan, userId } = req.body;
        
        if (!plan || !['monthly', 'yearly'].includes(plan)) {
            return res.status(400).json({ 
                error: 'Plan invalide',
                message: 'Le plan doit être "monthly" ou "yearly"' 
            });
        }
        
        const amount = plan === 'monthly' ? '2.49' : '9.99';
        const planName = plan === 'monthly' ? 'Mensuel' : 'Annuel';

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: { 
                    currency_code: 'EUR', 
                    value: amount 
                },
                description: `ColiVoyage Premium ${planName}`,
                custom_id: userId || 'anonymous',
                soft_descriptor: 'ColiVoyage'
            }],
            application_context: {
                brand_name: 'ColiVoyage',
                landing_page: 'NO_PREFERENCE',
                user_action: 'PAY_NOW',
                return_url: `${process.env.FRONTEND_URL || 'https://colivoyage-odx8.vercel.app'}/?payment=success&method=paypal`,
                cancel_url: `${process.env.FRONTEND_URL || 'https://colivoyage-odx8.vercel.app'}/?payment=cancel`
            }
        });

        const order = await paypalClient.execute(request);
        
        // Enregistrer le paiement en attente
        if (supabase && userId) {
            try {
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
            } catch (dbError) {
                console.log('⚠️  Erreur enregistrement DB:', dbError.message);
            }
        }
        
        res.json({ 
            id: order.result.id, 
            links: order.result.links, 
            success: true 
        });
    } catch (error) {
        console.error('❌ PayPal create order error:', error.message);
        res.status(500).json({ 
            error: 'Erreur lors de la création de la commande',
            details: error.message 
        });
    }
});

// ============================================
// 💳 PAYPAL - CAPTURER LE PAIEMENT
// ============================================
app.post('/api/paypal/capture', async (req, res) => {
    if (!paypalClient) {
        return res.status(503).json({ error: 'PayPal non configuré' });
    }
    
    try {
        const { orderId, userId, plan } = req.body;
        
        if (!orderId) {
            return res.status(400).json({ error: 'orderId requis' });
        }
        
        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const capture = await paypalClient.execute(request);

        if (capture.result.status === 'COMPLETED') {
            // Activer Premium dans la DB
            if (supabase && userId) {
                try {
                    const premiumUntil = new Date();
                    if (plan === 'monthly') {
                        premiumUntil.setMonth(premiumUntil.getMonth() + 1);
                    } else {
                        premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
                    }
                    
                    await supabase.from('users').update({
                        is_premium: true, 
                        premium_plan: plan,
                        premium_since: new Date().toISOString(),
                        premium_until: premiumUntil.toISOString()
                    }).eq('id', userId);
                    
                    await supabase.from('payments').update({
                        status: 'completed'
                    }).eq('transaction_id', orderId);
                    
                    console.log(`✅ Premium activé pour user ${userId}`);
                } catch (dbError) {
                    console.log('⚠️  Erreur DB:', dbError.message);
                }
            }
        }
        
        res.json({ 
            status: capture.result.status, 
            success: true,
            details: capture.result
        });
    } catch (error) {
        console.error('❌ PayPal capture error:', error.message);
        res.status(500).json({ 
            error: 'Erreur lors de la capture',
            details: error.message 
        });
    }
});

// ============================================
// 👤 UTILISATEURS
// ============================================

// Récupérer un utilisateur
app.get('/api/user/:userId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.params.userId)
            .single();
            
        if (error) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Créer un utilisateur
app.post('/api/user', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('users')
            .insert(req.body)
            .select()
            .single();
            
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mettre à jour un utilisateur
app.put('/api/user/:userId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('users')
            .update(req.body)
            .eq('id', req.params.userId)
            .select()
            .single();
            
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ✈️ TRAJETS
// ============================================

// Récupérer tous les trajets actifs
app.get('/api/trajets', async (req, res) => {
    if (!supabase) return res.json([]);
    
    try {
        const { depart, destination, date_depart } = req.query;
        
        let query = supabase
            .from('trajets')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });
        
        if (depart) query = query.eq('depart', depart);
        if (destination) query = query.eq('destination', destination);
        if (date_depart) query = query.gte('date_depart', date_depart);
        
        const { data, error } = await query;
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('❌ Erreur récupération trajets:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Créer un trajet
app.post('/api/trajets', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('trajets')
            .insert(req.body)
            .select()
            .single();
            
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mettre à jour un trajet
app.put('/api/trajets/:trajetId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('trajets')
            .update(req.body)
            .eq('id', req.params.trajetId)
            .select()
            .single();
            
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Supprimer un trajet
app.delete('/api/trajets/:trajetId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { error } = await supabase
            .from('trajets')
            .delete()
            .eq('id', req.params.trajetId);
            
        if (error) throw error;
        res.json({ success: true, message: 'Trajet supprimé' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 📦 COLIS
// ============================================

// Récupérer tous les colis en attente
app.get('/api/colis', async (req, res) => {
    if (!supabase) return res.json([]);
    
    try {
        const { depart, destination, status } = req.query;
        
        let query = supabase
            .from('colis')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (status) {
            query = query.eq('status', status);
        } else {
            query = query.eq('status', 'en_attente');
        }
        
        if (depart) query = query.eq('depart', depart);
        if (destination) query = query.eq('destination', destination);
        
        const { data, error } = await query;
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('❌ Erreur récupération colis:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Créer un colis
app.post('/api/colis', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('colis')
            .insert(req.body)
            .select()
            .single();
            
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mettre à jour un colis
app.put('/api/colis/:colisId', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('colis')
            .update(req.body)
            .eq('id', req.params.colisId)
            .select()
            .single();
            
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 💬 MESSAGES
// ============================================

// Récupérer les messages d'une conversation
app.get('/api/messages/:conversationId', async (req, res) => {
    if (!supabase) return res.json([]);
    
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', req.params.conversationId)
            .order('created_at', { ascending: true });
            
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Envoyer un message
app.post('/api/messages', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Base de données non configurée' });
    
    try {
        const { data, error } = await supabase
            .from('messages')
            .insert(req.body)
            .select()
            .single();
            
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 🔔 NOTIFICATIONS
// ============================================
app.get('/api/notifications/:userId', async (req, res) => {
    if (!supabase) return res.json([]);
    
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', req.params.userId)
            .order('created_at', { ascending: false })
            .limit(20);
            
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 🚫 GESTION DES ROUTES INCONNUES
// ============================================
app.use((req, res) => {
    res.status(404).json({
        error: 'Route non trouvée',
        method: req.method,
        path: req.path,
        message: 'Consultez / pour voir la liste des endpoints disponibles'
    });
});

// ============================================
// 🛡️ GESTION DES ERREURS GLOBALES
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Erreur globale:', err);
    res.status(500).json({
        error: 'Erreur serveur interne',
        message: err.message
    });
});

// ============================================
// 🚀 DÉMARRAGE DU SERVEUR
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 ColiVoyage Backend running on port ${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'not set'}`);
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log('='.repeat(50) + '\n');
});

// ============================================
// 🛑 GESTION DE LA FERMETURE PROPRE
// ============================================
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing server');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
