import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || 'threads-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production'
    }
}));

const checkAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

app.get('/', checkAuth, async (req, res) => {
    const { data: posts } = await supabase
        .from('posts')
        .select('*, profiles:user_id(avatar_url), likes(user_id)')
        .is('parent_id', null)
        .order('created_at', { ascending: false });
    res.render('index', { posts, user: req.session.user });
});

app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
    const { email, password, username } = req.body;
    const { data, error } = await supabase.auth.signUp({ 
        email, password, options: { data: { username } } 
    });
    if (error) return res.send(error.message);
    res.redirect('/login');
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.send(error.message);
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    req.session.user = { id: data.user.id, username: profile.username, avatar_url: profile.avatar_url };
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/post', checkAuth, async (req, res) => {
    const replyTo = req.query.replyTo || null;
    let parentPost = null;
    if (replyTo) {
        const { data } = await supabase.from('posts').select('*').eq('id', replyTo).single();
        parentPost = data;
    }
    res.render('post', { user: req.session.user, replyTo, parentPost });
});

app.post('/post', checkAuth, async (req, res) => {
    const { content, parent_id } = req.body;
    await supabase.from('posts').insert({
        user_id: req.session.user.id,
        username: req.session.user.username,
        content: content,
        parent_id: parent_id ? parseInt(parent_id) : null
    });
    res.redirect('/');
});

app.get('/profile/:id?', checkAuth, async (req, res) => {
    const targetId = req.params.id || req.session.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', targetId).single();
    const { data: posts } = await supabase.from('posts').select('*').eq('user_id', targetId).order('created_at', { ascending: false });
    res.render('profile', { profile, posts, isMe: targetId === req.session.user.id, user: req.session.user });
});

app.post('/like/:id', checkAuth, async (req, res) => {
    const postId = req.params.id;
    const userId = req.session.user.id;
    const { data: existing } = await supabase.from('likes').select('*').eq('user_id', userId).eq('post_id', postId).single();
    if (existing) {
        await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', postId);
    } else {
        await supabase.from('likes').insert({ user_id: userId, post_id: postId });
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
