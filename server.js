require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const paypal = require('@paypal/checkout-server-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(bodyParser.json());

// ============================================
// SUPABASE CONFIGURATION
// ============================================
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// PAYPAL CONFIGURATION
// ============================================
const paypalEnv = process.env.PAYPAL_MODE === 'live'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_SECRET);
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// ============================================
// 📧 BREVO CONFIGURATION
// ============================================
const BREVO_API_KEY = process.env.BREVO_API_KEY;
let brevoStatus = '❌ Non configuré';

if (BREVO_API_KEY) {
    brevoStatus = '✅ Configuré';
    console.log('✅ Brevo configuré');
} else {
    console.log('⚠️ Brevo non configuré');
}

// ============================================
// 🏠 ROUTE TEST
// ============================================
app.get('/', (req, res) => {
    res.json({
        status: '✅ ColiVoyage API is running!',
        version: '2.0.0',
        message: 'Backend opérationnel 🚀',
        services: {
            supabase: process.env.SUPABASE_URL ? '✅ Connected' : '❌ Not configured',
            paypal: process.env.PAYPAL_CLIENT_ID ? '✅ Configured' : '❌ Not configured',
            resend: resendStatus
        },
        endpoints: [
            'GET /',
            'GET /api/health',
            'POST /api/auth/email',
            'POST /api/auth/verify-email-code',
            'POST /api/paypal/create-order',
            'POST /api/paypal/capture',
            'GET /api/user/:userId',
            'GET /api/user/by-phone/:phone',
            'POST /api/user',
            'PUT /api/user/:userId',
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
// 📧 LOGIN PAR EMAIL - Code via BREVO
// ============================================
app.post('/api/auth/email', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    if (!BREVO_API_KEY) return res.status(503).json({ error: 'Brevo non configuré' });
    
    try {
        const { email } = req.body;
        
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Email invalide' });
        }
        
        // Générer un code à 6 chiffres
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`📧 Génération code pour ${email}: ${code}`);
        
        // Sauvegarder le code
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        
        await supabase.from('otp_codes').insert({
            email: email,
            code: code,
            expires_at: expiresAt.toISOString(),
            used: false
        });
        
        // Envoyer l'email via BREVO
        const emailResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'accept': 'application/json',
                'api-key': BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    name: 'ColiVoyage',
                    email: 'ibnyaminahamadamnemoi@gmail.com'  // Ton email vérifié Brevo
                },
                to: [{
                    email: email
                }],
                subject: `🔐 Ton code ColiVoyage : ${code}`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                        <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 12px 12px 0 0;">
                            <h1 style="color: white; margin: 0;">✈️ ColiVoyage</h1>
                        </div>
                        <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px;">
                            <h2 style="color: #333;">Bienvenue ! 👋</h2>
                            <p style="color: #666; font-size: 16px;">Voici ton code de connexion :</p>
                            <div style="background: white; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0; border: 2px dashed #6366f1;">
                                <div style="font-size: 36px; font-weight: bold; color: #6366f1; letter-spacing: 8px;">
                                    ${code}
                                </div>
                            </div>
                            <p style="color: #666; font-size: 14px;">
                                ⏱️ Ce code expire dans <strong>10 minutes</strong>.
                            </p>
                            <p style="color: #999; font-size: 12px; margin-top: 30px;">
                                Si tu n'as pas demandé ce code, ignore cet email.
                            </p>
                        </div>
                        <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                            © 2026 ColiVoyage - Transport de colis entre particuliers
                        </div>
                    </div>
                `
            })
        });
        
        const emailData = await emailResponse.json();
        
        if (!emailResponse.ok) {
            console.error('❌ Erreur Brevo:', emailData);
            return res.status(500).json({ error: 'Erreur envoi email' });
        }
        
        console.log('✅ Email envoyé via Brevo:', emailData.messageId);
        res.json({ success: true, message: 'Code envoyé ! 📧' });
        
    } catch (error) {
        console.error('❌ Erreur serveur:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 🔐 VÉRIFIER LE CODE EMAIL
// ============================================
app.post('/api/auth/verify-email-code', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ error: 'Email et code requis' });
        }
        
        console.log(`🔐 Vérification code pour ${email}: ${code}`);
        
        const { data: otpData, error: otpError } = await supabase
            .from('otp_codes')
            .select('*')
            .eq('email', email)
            .eq('code', code)
            .eq('used', false)
            .gte('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (otpError || !otpData) {
            return res.status(401).json({ error: 'Code invalide ou expiré' });
        }
        
        await supabase.from('otp_codes').update({ used: true }).eq('id', otpData.id);
        
        let { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        
        if (!user) {
            const { data: newUser } = await supabase
                .from('users')
                .insert({ email: email, name: email.split('@')[0] })
                .select()
                .single();
            user = newUser;
        }
        
        console.log('✅ Utilisateur connecté:', user.email);
        res.json({ success: true, user: user });
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        res.status(500).json({ error: error.message });
    }
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
                amount: { currency_code: 'EUR', value: amount },
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

        res.json({ id: order.result.id, links: order.result.links, success: true });
    } catch (error) {
        console.error('PayPal error:', error);
        res.status(500).json({ error: error.message, success: false });
    }
});

// ============================================
// 🅿️ PAYPAL - CAPTURER
// ============================================
app.post('/api/paypal/capture', async (req, res) => {
    try {
        const { orderId, userId, plan } = req.body;
        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});
        const capture = await paypalClient.execute(request);

        if (capture.result.status === 'COMPLETED') {
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

                await supabase.from('payments').update({ status: 'completed' }).eq('transaction_id', orderId);
            }

            console.log(`✅ Premium activé pour ${userId} - Plan: ${plan}`);
        }

        res.json({ status: capture.result.status, success: true });
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

app.get('/api/user/by-phone/:phone', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'DB non configurée' });
    
    try {
        const phone = req.params.phone;
        console.log('🔍 Recherche user par phone:', phone);
        
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();
        
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        
        console.log('✅ Utilisateur trouvé:', data);
        res.json(data);
        
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
// 🚀 DÉMARRAGE SERVEUR (À LA FIN !)
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║   🚀 ColiVoyage Backend v2.0.0       ║');
    console.log(`║   Port: ${PORT}                          ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log(`📡 Frontend URL: ${process.env.FRONTEND_URL || 'Not set'}`);
    console.log(`💾 Supabase: ${process.env.SUPABASE_URL ? '✅ Connected' : '❌ Not configured'}`);
    console.log(`🅿️  PayPal:  ${process.env.PAYPAL_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`📧 Resend:  ${resendStatus}`);
    console.log('');
});