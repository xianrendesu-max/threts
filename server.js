require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// セッション設定
app.use(session({
    secret: 'threads-secret-key', // 実際は.envへ
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1日有効
}));

// 認証チェック用ミドルウェア
const checkAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// --- ルーティング ---

// メインフィード
app.get('/', checkAuth, async (req, res) => {
    const { data: posts } = await supabase
        .from('posts')
        .select('*, profiles:user_id(avatar_url), likes(user_id)')
        .is('parent_id', null)
        .order('created_at', { ascending: false });
    
    res.render('index', { posts, user: req.session.user });
});

// 新規登録
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
    const { email, password, username } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (error) return res.send(error.message);
    res.redirect('/login');
});

// ログイン
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.send(error.message);
    
    // セッションにユーザー情報を保存
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
    req.session.user = { id: data.user.id, username: profile.username, avatar_url: profile.avatar_url };
    res.redirect('/');
});

// ログアウト
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// 投稿・返信
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

// プロフィール (自分・他人)
app.get('/profile/:id?', checkAuth, async (req, res) => {
    const targetId = req.params.id || req.session.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', targetId).single();
    const { data: posts } = await supabase.from('posts').select('*').eq('user_id', targetId).order('created_at', { ascending: false });
    res.render('profile', { profile, posts, isMe: targetId === req.session.user.id, user: req.session.user });
});

// いいねトグル
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

app.listen(3000, () => console.log('Server: http://localhost:3000'));
